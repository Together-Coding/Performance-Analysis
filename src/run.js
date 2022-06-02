/**
 * Note: The values of the global variables are fixed at the init context.
 *  You need to return variables that are modified from ``setup()`` to be passed to default function.
 *  See more details from https://k6.io/docs/using-k6/test-life-cycle/
 * 
 * Note: ``handleSummary()`` only has the init context. It can't even use variables that are
 *  updated in ``setup()``.
 */


// 1. init code
import ws from "k6/ws";
import http from "k6/http";
import { check } from "k6";
import exec from 'k6/execution';
import { textSummary } from "./k6_summary.js"

import { uuidv4, isObject } from "./utils.js";
import { getTaskArn } from "./server.js";

// maximal period. In the meanwhile, ending flag is used to stop testing.
const MAX_TEST_PERIOD = 1000 * 60 * 60;

// K6 options  
// Note: default duration is 10m. When I set `duration` option explicitly, default function is
//  called after it is returned over and over for `duration`. Even using `exec.test.abort` 
//  does not prevent this. This can be fixed by setting executor as `shared-iterations`.
export const options = {
    scenarios: {
        singleIteration: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: MAX_TEST_PERIOD / 1000 / 60 + "m",
        },
    },
};

const IS_FARGATE = Boolean(__ENV.ECS_CONTAINER_METADATA_URI_V4)

// ecs metadata url. ex) http://169.254.170.2/v4/c6c6f12246ba4be181b0e25090416caf-527074092/task
const METADATA_TASK_URL = (__ENV.ECS_CONTAINER_METADATA_URI_V4 || "") + '/task'

const API_URL = 'https://api.together-coding.com'
const CONFIG_URL = IS_FARGATE ? 'https://ide-ws.together-coding.com' : 'http://host.docker.internal:8001'

let SERVER_SCHEME;
let SERVER_DOMAIN;
let SERVER_URL;
let SOCKETIO_URL;
let TOKEN;

let CONFIGS = {
    test_config: {
        "id": 0,
        "course_id": 0,
        "lesson_id": 0,
        "server_host": "string",
        "target_ptc_id": 0,
        "start_at": "2022-05-31T19:34:04.630Z",
        "end_at": "2022-05-31T19:34:04.630Z",
        "deleted": true,
        "started": true,
        "ended": true,
        "remaining_time": 0
    },
    "id": 0,
    "task_arn": "string",
    "user_id": 0,
    "ptc_id": 0,
    "active": true,
    "user": {
        "id": 0,
        "email": "string"
    }
}

function updateServerConfig(data) {
    CONFIGS = data;
    SERVER_DOMAIN = CONFIGS.test_config.server_host
    if (SERVER_DOMAIN.match(/\d+\.\d+\.\d+\.\d+/) || SERVER_DOMAIN.startsWith('host.docker.internal')) {
        // Localhost or private network
        SERVER_SCHEME = "http"
    } else {
        // Public network
        SERVER_SCHEME = "https"
    }

    SERVER_URL = `${SERVER_SCHEME}://${SERVER_DOMAIN}`
    SOCKETIO_URL = `${SERVER_SCHEME == "http" ? "ws" : "wss"}://${SERVER_DOMAIN}/socket.io/?EIO=4&transport=websocket`;
}

// 2. setup code
export function setup() {
    const task_arn = getTaskArn(http, IS_FARGATE, METADATA_TASK_URL)
    const payload = JSON.stringify({ task_arn });
    const params = {
        headers: { 'Content-Type': 'application/json' }
    }
    let resp = http.post(CONFIG_URL + "/admin/test/tester/start", payload, params);

    updateServerConfig(JSON.parse(resp.body));

    const payload2 = JSON.stringify({ 'email': CONFIGS.user.email, 'password': CONFIGS.user.email.slice(0, 8) });
    let resp2 = http.post(API_URL + "/auth/login", payload2, params);
    TOKEN = resp2.body;

    return {
        url: SOCKETIO_URL,
        configs: CONFIGS,
        server_url: SERVER_URL,
        task_arn,
        token: TOKEN,
    }
}

// 3. VU code. ``data`` is passed from ``setup``
export default function ({ url, configs, server_url, task_arn, token }) {
    SERVER_URL = server_url

    let socket;
    let log = [];
    let status = 0; // 0: initial waiting. 1: started. 2: ended
    const eventHandler = {}

    const on = (event, listener) => {
        eventHandler[event] = (data) => {
            console.log(`Recv : ${log.length}`)

            log.push(data)
            return listener(data);
        };
    }

    const emit = (event, data, type = 42) => {
        let msg;
        if (type == 42) {
            if (data == null) data = {}
            if (isObject(data) && event !== 'TIMESTAMP_ACK') {
                data['_ts_1'] = new Date().getTime();
                data['uuid'] = uuidv4();
            }
            msg = `${type}["${event}", ${JSON.stringify(data)}]`;
        } else if (type == 40) {
            // connect
            msg = `${type}{"${event}": ${JSON.stringify(data)}}`;
        } else if (type == 41 || type == 3) {
            // disconnect
            msg = `${type}`;
        }
        socket.send(msg);
    }

    on('TIME_SYNC_ACK', (data) => {
        data.ts2 = new Date().getTime();
        emit('TIME_SYNC_ACK', data);
    })

    on('echo', (data) => { })

    const cantHandleMessage = (e, data) => {
        if (data === "2") {
            // ping
            emit('pong', null, 3)
        } else {
            console.error(e, data);
        }
    }

    /**
     * Notify end of test to the server sending log data.
     */
    const notifyEnd = () => {
        let payload = JSON.stringify({
            task_arn,
            log,
        })

        let params = {
            headers: { 'Content-Type': 'application/json' }
        }
        let resp = http.post(CONFIG_URL + "/admin/test/tester/end", payload, params)
        if (resp.status != 200) {
            console.log(resp)
        }
    }

    /**
     * Stop test
     */
    const stopTest = (socket) => {
        // Processes to do before stop
        notifyEnd();

        // Disconnect socket connection
        status = 2;
        emit('disconnect', null, 41);
        socket.close();

        // Abort K6
        exec.test.abort("End");
    }

    const echo = () => {
        emit('echo', {
            'ping': 'pong',
            'uuid': uuidv4(),
            '_ts_1': new Date().getTime(),
        });
    }

    const emitRandom = (socket) => {
        if (status !== 1) return;

        // TODO: emit event 랜덤하게 실행
        echo();
    }

    const response = ws.connect(url, {}, function (_socket) {
        socket = _socket
        socket.setInterval(() => {
            let resp = http.get(server_url + "/admin/test/" + configs.test_config.id)
            if (resp.status != 200) return console.error("/admin/test/" + configs.test_config.id, resp)

            configs.test_config = JSON.parse(resp.body)
            if (status === 0 && configs.test_config.started) {
                // Start testing
                status = 1
            } else if (configs.test_config.deleted || status === 1 && configs.test_config.ended) {
                // Stop testing
                stopTest(socket);
            }
        }, 1000)

        socket.setInterval(() => echo(), 1000 * 10);

        // on connection
        socket.on("open", function open() {
            emit("Authorization", `Bearer ${token}`, 40)
            emit('TIME_SYNC', { ts1: new Date().getTime() })
        });

        socket.setInterval(() => {
            emitRandom();
        }, 1000 * 0.5);

        // on message (event)
        socket.on("message", (msg) => {
            let m = msg.match(/(\d{2})\[\"(.+?)\"\,(.+)\]/)

            if (!m) return cantHandleMessage("Not Match", msg);

            let type, event, data;
            try {
                type = m[1]
                event = m[2]
                data = JSON.parse(m[3])
            } catch (e) {
                return cantHandleMessage(e, msg);
            }

            console.log(type, event, data)

            if (isObject(data) && data.hasOwnProperty('_ts_3')) {
                data['_ts_4'] = new Date().getTime();
                emit('TIMESTAMP_ACK', data);
            } else {
                console.error(data)
            }

            if (eventHandler[event] == null) return cantHandleMessage("No Handler", data);

            return eventHandler[event](data);
        });

        socket.on("close", function close() {
            console.log("disconnected");
        });

        socket.on("error", function (e) {
            console.log("error", e);
            if (e.error() != "websocket: close sent") {
                console.error("An unexpected error occurred: ", e.error());
            }
        });

        // Set end of test
        socket.setTimeout(function () {
            stopTest(socket);
        }, MAX_TEST_PERIOD);
    });

    check(response, { "status is 101": (r) => r && r.status === 101 });
}

// Customize end of test summary. See https://k6.io/docs/results-visualization/end-of-test-summary/
export function handleSummary(data) {
    const task_arn = getTaskArn(http, IS_FARGATE, METADATA_TASK_URL)
    let payload = JSON.stringify({
        task_arn,
        summary: data,
    })
    let params = {
        headers: { 'Content-Type': 'application/json' }
    }
    let resp = http.post(CONFIG_URL + "/admin/test/tester/summary", payload, params)
    if (resp.status != 200) {
        console.log(resp)
    }

    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }) + "\n\n",
    }
}
