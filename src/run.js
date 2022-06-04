/**
 * Note: The values of the global variables are fixed at the init context.
 *  You need to return variables that are modified from ``setup()`` to be passed to default function.
 *  See more details from https://k6.io/docs/using-k6/test-life-cycle/
 * 
 * Note: ``handleSummary()`` only has the init context. It can't even use variables that are
 *  updated in ``setup()``.
 */


// 1. init code
import { check } from "k6";
import ws from "k6/ws";
import http from "k6/http";
import { b64decode } from "k6/encoding";
import { uuidv4, randomIntBetween } from "./k6_utils.js";
import { textSummary } from "./k6_summary.js"

import { isObject, getEvent, getRandFileName, getRandFromObjKey, getRandWords, getRandWord } from "./utils.js";
import { getTaskArn } from "./server.js";
import {
    EV_ECHO,
    EV_TIMESTAMP_ACK,
    EV_TIME_SYNC,
    EV_TIME_SYNC_ACK,

    EV_INIT_LESSON,
    EV_ACTIVITY_PING,
    EV_ALL_PARTICIPANT,
    EV_PARTICIPANT_STATUS,
    EV_PROJECT_ACCESSIBLE,

    EV_DIR_INFO,
    EV_FILE_CREATE,
    EV_FILE_READ,
    EV_FILE_UPDATE,
    EV_FILE_DELETE,
    EV_FILE_MOD,
    EV_FILE_SAVE,
    EV_CURSOR_MOVE,

    EV_FEEDBACK_ADD,
    EV_FEEDBACK_COMMENT,
    EVENT_RATE,
    EV_FEEDBACK_LIST,

} from "./constants.js";
import { codes } from "./dummy.js";

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

    let initialized = false;
    let target_ptc_id = configs.test_config.target_ptc_id || configs.ptc_id; // if null, interact with itself
    let targetData = {
        dir: {}, // filename: {content: ..., ...}
        accessible_to: [],
        accessed_by: [],
    };
    let globalData = {
        all_participant: {}, // id: ptc into
        feedbacks: {}, // feedback_id: {...}
    };
    let currentFile = null; // currently opened file
    const dummyCode = {
        code: codes[randomIntBetween(0, codes.length - 1)],
        pos: 0, // seek position
    }

    const eventHandler = {}
    const eventChain = {}

    const on = (event, listener) => {
        eventHandler[event] = (data) => {
            log.push(data);
            if (log.length % 100 == 0) console.log(`Recv : ${log.length}`);

            // Call event handler
            listener(data);

            // Call chains
            for (let i = 0; i < (eventChain[event] ? eventChain[event].length : 0); i++)
                (eventChain[event].shift())();
        };
    }

    const addChain = (event, chain) => {
        if (chain == null) return;

        if (eventChain[event] == null) eventChain[event] = []
        eventChain[event].push(chain)
    }

    /**
     * @param {*} chain one-time callback when ``event`` is received
     */
    const emit = (event, data = null, chain = null, type = 42) => {
        if (typeof chain == "function") chain = [chain];
        if (chain != null) {
            for (let c of chain) addChain(event, c);
        }

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
        console.info('    🚀    EMIT', msg)
    }

    const cantHandleMessage = (e, data) => {
        if (data === "2") {
            // ping
            emitHandler["ping"]();
        } else {
            // console.error(e, data);
        }
    }

    const getRandCursor = () => {
        if (targetData.dir[currentFile] == null) return [0, 0, 0];

        let line = (targetData.dir[currentFile].content.match(/\n/g) || []).length + 1;
        let cursorPos = randomIntBetween(1, line);
        let cursorPosCol = randomIntBetween(1, 10);
        return [line, cursorPos, cursorPosCol];
    }

    /**
     * Notify end of test to the server sending log data.
     */
    const notifyEnd = () => {
        let payload = JSON.stringify({ task_arn, log, })

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
        emitHandler["disconnect"]()
        socket.close();

        // Abort K6 by closing connection
        socket.close()
    }

    /**
     * Return a few letters of code snippet formatted for FILE_MOD emission.
     */
    const readCodeToModify = () => {
        // Read a few from code
        let readLen = randomIntBetween(5, 20);
        let codeStr = dummyCode.code.slice(dummyCode.pos, dummyCode.pos + readLen);

        // Write currentFile, because the writer does not receive his/her FILE_MOD event.
        targetData.dir[currentFile].content += codeStr;

        // Update pos
        dummyCode.pos += readLen;
        if (dummyCode.pos >= dummyCode.code.length) dummyCode.pos -= dummyCode.code.length;

        // Add backspaces for little bit of reality. 
        let codeStrRes = [];
        let intact = 0;  // not backspaced length

        for (let i = 0; i < codeStr.length; i++) {
            codeStrRes.push(codeStr[i])
            intact += 1;
            let p = Math.random();
            if (p < 0.05) {
                let randWord = getRandWord();
                for (let j = 0; j < randWord.length; j++)
                    codeStrRes.push(randWord[j]);
                for (let j = 0; j < randWord.length; j++)
                    codeStrRes.push(8);
                intact = 0
            } else if (p < 0.2) {
                let toBack = randomIntBetween(0, intact)
                let backedChar = []
                for (let j = 0; j < toBack; j++) {
                    backedChar.push(codeStrRes[codeStrRes.length + (-1) * (2 * j + 1)])
                    codeStrRes.push(8) // backspace
                }
                for (let j = 0; j < toBack; j++)
                    codeStrRes.push(backedChar[toBack - j - 1]);
                intact = toBack;
            }
        }
        return codeStrRes;
    }

    /**
     * Return last position cursor of ``currentFile``
     */
    const lastPositionCursor = () => {
        if (currentFile == null || targetData.dir[currentFile] == null) return '0.0';

        let row = (targetData.dir[currentFile].content.match(/\n/g) || []).length;
        let col = targetData.dir[currentFile].content.split('\n')[row].length
        return `${row}.${col}`
    }


    /**
     * Subscribe events
     */
    on(EV_TIME_SYNC_ACK, (data) => {
        data.ts2 = new Date().getTime();
        emitHandler[EV_TIME_SYNC_ACK](data);
    })

    on(EV_ECHO, (data) => { })

    on(EV_INIT_LESSON, (data) => {
        emitHandler[EV_ALL_PARTICIPANT]()
        emitHandler[EV_PROJECT_ACCESSIBLE]()
    })

    on(EV_ALL_PARTICIPANT, data => {
        for (let d of data.participants) {
            globalData.all_participant[d.id] = d
        }
    })

    on(EV_PARTICIPANT_STATUS, data => {
        globalData.all_participant[data.id] = data
    })

    on(EV_PROJECT_ACCESSIBLE, data => {
        targetData.accessible_to = data.accessible_to
        targetData.accessed_by = data.accessed_by
    })

    on(EV_DIR_INFO, data => {
        if (data.error) return;
        if (!data.file) return;

        let files = data.file
            .map((item) => b64decode(item, "url", "s"))
            .filter((name) => !name.endsWith("_"));

        for (let file of files) {
            targetData.dir[file] = { content: '' }
        }
    })

    on(EV_FILE_READ, data => {
        if (data.ownerId != target_ptc_id) return;
        else if (targetData.dir[data.file])
            targetData.dir[data.file].content = data.content;
        else
            targetData.dir[data.file] = { content: data.content };
        currentFile = data.file

        // sync cursor
        emitHandler[EV_CURSOR_MOVE]("open");
    })

    on(EV_FILE_CREATE, data => {
        if (data.error) return;
        else if (data.ownerId != target_ptc_id) return;
        else if (data.type == 'directory') return;
        targetData.dir[data.name] = { content: '' }
    })

    on(EV_FILE_DELETE, data => {
        if (data.ownerId != target_ptc_id) return;
        else if (data.error) return;
        delete targetData.dir[data.name]
    })

    on(EV_FILE_UPDATE, data => {
        if (data.error) return;
        else if (data.ownerId != target_ptc_id) return;
        else if (data.type == 'file') {
            const prev = Object.assign({}, targetData.dir[data.name]);
            delete targetData.dir[data.name]
            targetData.dir[data.rename] = prev;
        } else {
            // directory
        }
    })

    on(EV_CURSOR_MOVE, data => {
        if (data.ptcId != target_ptc_id) return;
        else {
            // XXX: I think, there's nothing to do on this event when it comes to testing.
        }
    })

    on(EV_FILE_SAVE, data => { })

    on(EV_FEEDBACK_LIST, data => {
        for (let d of data) {
            let feedbacks = d.refs ? (d.refs.feedbacks ? d.refs.feedbacks : []) : [];
            for (let f of feedbacks) {
                // Only save accessible feedbacks
                if (f.acl && f.acl.includes(configs.ptc_id)) {
                    globalData.feedbacks[f.id] = f;
                }
            }
        }
    })

    on(EV_FEEDBACK_ADD, data => {
        let f = data.feedback;
        f.comments = [data.comment];
        globalData.feedbacks[f.id] = f;
    })

    on(EV_FEEDBACK_COMMENT, data => {
        let f = data.feedback
        if (globalData.feedbacks[f.id] == null) globalData.feedbacks[f.id] = f;
        if (globalData.feedbacks[f.id].comments == null) globalData.feedbacks[f.id].comments = [];

        globalData.feedbacks[f.id].comments.push(data.comment);
    })

    /**
     * Register emit handler
     */
    const emitHandler = {
        // Periodic and randomly
        [EV_DIR_INFO]: (chain) => {
            return emit(EV_DIR_INFO, { targetId: target_ptc_id }, chain)
        },
        [EV_FILE_READ]: (chain) => {
            return emit(EV_FILE_READ, {
                ownerId: target_ptc_id,
                file: getRandFromObjKey(targetData.dir),
            }, chain)
        },
        [EV_CURSOR_MOVE]: (event = "move", chain) => {
            // or event="open"
            let c = getRandCursor()
            return emit(EV_CURSOR_MOVE, {
                fileInfo: {
                    ownerId: target_ptc_id, // owner
                    file: currentFile, // current viewed file
                    line: c[0], // Total line num
                    cursor: `${c[1]}.${c[2]}`,
                },
                event,
                timestamp: Date.now(),
            }, chain)
        },
        [EV_FILE_MOD]: (chain) => {
            return emit(EV_FILE_MOD, {
                ownerId: target_ptc_id,
                file: currentFile,
                cursor: lastPositionCursor(),
                timestamp: Date.now(),
                change: readCodeToModify(),
            })

        },
        [EV_FILE_SAVE]: (chain) => {
            if (currentFile == null || targetData.dir[currentFile] == null) return;

            return emit(EV_FILE_SAVE, {
                ownerId: target_ptc_id,
                file: currentFile,
                content: targetData.dir[currentFile] || '',
            }, chain)

        },
        [EV_FEEDBACK_ADD]: (chain) => {
            let c = getRandCursor()
            return emit(EV_FEEDBACK_ADD, {
                ref: {
                    ownerId: target_ptc_id,
                    file: currentFile,
                    line: `${c[1]}.${c[2]}`
                },
                acl: Object.keys(globalData.all_participant),  // all ptcs
                comment: getRandWords() + "???",
            }, chain)
        },
        [EV_FEEDBACK_COMMENT]: (chain) => {
            if (Object.keys(globalData.feedbacks).length <= 0) return emitHandler[EV_FEEDBACK_ADD](chain);
            return emit(EV_FEEDBACK_COMMENT, {
                feedbackId: getRandFromObjKey(globalData.feedbacks),
                content: getRandWords() + "."
            }, chain)
        },

        /* Non-periodic */
        [EV_FEEDBACK_LIST]: (chain) => emit(EV_FEEDBACK_LIST, null, chain),
        [EV_ECHO]: (chain) => {
            return emit(EV_ECHO, { 'ping': 'pong' }, chain)
        },
        [EV_ACTIVITY_PING]: (chain) => {
            return emit(EV_ACTIVITY_PING, { targetId: target_ptc_id }, chain)
        },
        [EV_ALL_PARTICIPANT]: (chain) => emit(EV_ALL_PARTICIPANT, chain),
        [EV_PROJECT_ACCESSIBLE]: (chain) => emit(EV_PROJECT_ACCESSIBLE, chain),
        [EV_FILE_CREATE]: (chain) => {
            return emit(EV_FILE_CREATE, {
                ownerId: target_ptc_id,
                type: 'file',
                name: getRandFileName(),
            }, chain)
        },
        [EV_FILE_UPDATE]: (chain) => {
            return emit(EV_FILE_UPDATE, {
                ownerId: target_ptc_id,
                type: 'file',
                name: getRandFromObjKey(targetData.dir),
                rename: getRandFileName(),
            }, chain)
        },
        [EV_FILE_DELETE]: (chain) => {
            const filename = getRandFromObjKey(targetData.dir);
            if (filename === currentFile) return;
            return emit(EV_FILE_DELETE, {
                ownerId: target_ptc_id,
                type: 'file',
                name: filename,
            }, chain)
        },
        [EV_INIT_LESSON]: (data, chain) => {
            return emit(EV_INIT_LESSON, data, chain)
        },
        [EV_TIME_SYNC]: (data) => emit(EV_TIME_SYNC, data),
        [EV_TIME_SYNC_ACK]: (data) => emit(EV_TIME_SYNC_ACK, data),
        [EV_TIMESTAMP_ACK]: (data) => emit(EV_TIMESTAMP_ACK, data),
        Authorization: (message) => emit("Authorization", message, null, 40),
        disconnect: () => emit('disconnect', null, null, 41),
        ping: () => emit('ping', null, null, 3),
    }

    const isEmittable = () => {
        return status === 1 && initialized
    }

    /**
     * Emit random event
     */
    const emitRandom = () => {
        if (!isEmittable()) return;

        let handler = emitHandler[getEvent()];
        handler && handler();
    }

    const emitAfterInit = (event, ...args) => {
        if (!isEmittable()) return;
        emitHandler[event](...args);
    }

    /**
     * Start test
     */
    const response = ws.connect(url, {}, function (_socket) {
        socket = _socket
        let timeout_10s = null;
        let timeout_60s = null;

        socket.setInterval(() => {
            let resp = http.get(
                server_url + "/admin/test/" + configs.test_config.id,
                { timeout: '10s' }
            )
            if (resp.status != 200) {
                console.error("/admin/test/" + configs.test_config.id, resp);
                stopTest(socket);
            }

            configs.test_config = JSON.parse(resp.body)
            if (status === 0 && configs.test_config.started) {
                // Start testing
                status = 1
            } else if (configs.test_config.deleted || (status === 1 && configs.test_config.ended)) {
                // Stop testing
                stopTest(socket);
            }

            if (!timeout_10s) {
                timeout_10s = 1
                socket.setTimeout(() => {
                    emitAfterInit(EV_ACTIVITY_PING)
                    emitAfterInit(EV_FEEDBACK_LIST)
                    timeout_10s = null;
                }, 1000 * 10)
            }
            if (!timeout_60s) {
                if (!isEmittable()) return;
                timeout_60s = 1
                socket.setTimeout(() => {
                    emitAfterInit(EV_FILE_CREATE)
                    timeout_60s = null;
                }, 1000 * 60)
            }
        }, 1000)

        // on connection
        socket.on("open", () => {
            emitHandler["Authorization"](`Bearer ${token}`)
            emitHandler[EV_TIME_SYNC]({ ts1: new Date().getTime() });
            emitHandler[EV_INIT_LESSON]({
                courseId: configs.test_config.course_id,
                lessonId: configs.test_config.lesson_id,
            }, () => {
                emitHandler[EV_DIR_INFO](() => {
                    if (Object.keys(targetData.dir).length == 0) {
                        emitHandler[EV_FILE_CREATE](() => {
                            emitHandler[EV_FILE_READ](() => {
                                initialized = true;
                            });
                        });
                    } else {
                        emitHandler[EV_FILE_READ](() => {
                            initialized = true;
                        });
                    }
                }, () => {
                    emitHandler[EV_FEEDBACK_LIST]();
                });
            })
        });

        socket.setInterval(() => {
            socket.setTimeout(() => {
                emitRandom();
            }, 1)
        }, 1000 / EVENT_RATE);

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

            console.info("      👀  RECV ", type, event, data)

            if (isObject(data) && data.hasOwnProperty('_ts_3')) {
                data['_ts_4'] = new Date().getTime();
                emitHandler[EV_TIMESTAMP_ACK](data);
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
