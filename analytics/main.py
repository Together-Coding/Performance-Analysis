"""
- The number of send/recv messages
- Send/Recv bytes
- Average delay for each event
- Average delay for all target events

1. Measure delay of message that originated from client A and is sent to Client B (can be A)
    Goal: avg 300 ms
    1) Client: Only limited to FILE_MOD event, receiver accumulate (_ts_4 - _ts_1).
    2) Analytics: Accumulate all metrics from all test machines. calculate average delay

2. 50 test users send two messages per seconds for 5 minutes and measure average delay.
    Goal: avg 450 ms
    1) Check at least 60s * 5m * 2# = 600 messages are received.
    2) Client: For all target events, receiver accumulate (_ts_4 - _ts_1).
    3) Analytics: Accumulate all metrics from all test machines. calculate average delay

=> Need to measure delay and count of received message for each event and each test machine.
"""

import argparse
import json
import os
import subprocess
from collections import defaultdict

ABS_PATH = os.getcwd()
LOG_PATH = os.path.join("logs")

SUMMARY_FILE_PREFIX = "summary-"
PROCESSED_FILE_PREFIX = "proc-"

DELAY_METRIC_PREFIX = "DELAY_"
RECV_METRIC_PREFIX = "RECV_"
SEND_METRIC_PREFIX = "SEND_"
REMAINING_TIME_KEY = "REMAINING_TIME"


def rnd(v, prec=2):
    return round(v, prec)


def process_summary(test_id):
    log_folder = os.path.join(LOG_PATH, str(test_id))
    summary_files = []

    print("Reading ...")
    files = list(filter(lambda f: f.endswith('.json'), os.listdir(log_folder)))
    for idx, file in enumerate(sorted(files)):
        print(f"{idx:3}. {file}")
        
        if file.startswith(SUMMARY_FILE_PREFIX):
            with open(os.path.join(log_folder, file), "rt") as fp:
                summary_files.append(json.loads(fp.read()))

    bytes_sent = 0  # kB
    bytes_recv = 0  # kB

    recv_counter = defaultdict(int)  # recv count
    send_counter = defaultdict(int)  # send count
    delay_counter = defaultdict(float)  # delay time in milliseconds
    duration = 0  # max duration
    total_recv = 0
    total_send = 0
    total_delay = 0.0

    for summary in summary_files:
        metrics: dict = summary["metrics"]
        # bytes_sent += metrics["ws_msgs_sent"]["values"]["count"]  # ws_msgs_* is the number of messages sent/recved
        # bytes_recv += metrics["ws_msgs_received"]["values"]["count"]
        duration_ = round(metrics["REMAINING_TIME"]["values"]["max"], -1)  # round to int
        if duration_ > duration:
            duration = duration_

        for k, v in metrics.items():
            k: str
            v: dict
            if k.startswith(RECV_METRIC_PREFIX):
                ev = k.split("_", 1)[1]
                value = v["values"]["count"]
                recv_counter[ev] += value
                total_recv += value
            elif k.startswith(SEND_METRIC_PREFIX):
                ev = k.split("_", 1)[1]
                value = v["values"]["count"]
                send_counter[ev] += value
                total_send += value
            elif k.startswith(DELAY_METRIC_PREFIX):
                ev = k.split("_", 1)[1]
                value = v["values"]["count"]
                delay_counter[ev] += value
                total_delay += value

    print("\n# Event counter")
    print("Send counter  : ", json.dumps(send_counter, indent=2))
    print("Recv counter  : ", json.dumps(recv_counter, indent=2))
    print("Delay counter : ", json.dumps(delay_counter, indent=2))

    print("\n# Event : {delay by event} / {counter by event} = {avg delay by event}")
    for ev in sorted(recv_counter.keys()):
        v = delay_counter[ev] / recv_counter[ev]
        print(f"{ev:16} : {delay_counter[ev]:>10} / {recv_counter[ev]:<7} = {round(v, 2):8} ms/recv")

    test_machine_num = len(summary_files)
    print("\n# Summary")
    print(f"Test Machine Num : {test_machine_num:>10}")

    print(f"\nSent Event       : {total_send:>10} / {rnd(duration):<8} = {rnd(total_send / duration):8} #/s")
    # print(f"Sent Data        : {bytes_sent:>10} / {rnd(duration):<7} = {rnd(bytes_sent / duration):8} kB/s")
    # print(f"Data per send    : {bytes_sent:>10} / {total_send:<7} = {rnd(bytes_sent / total_send):8} kB/send")
    print(f"Sent Per machine : {total_send:>10} / {rnd(duration)} / {test_machine_num} = {rnd(total_send / duration / test_machine_num):8} #/s per machine")

    print(f"\nRecv Event       : {total_recv:>10} / {rnd(duration):<8} = {rnd(total_recv / duration):8} #/s")
    # print(f"Received Data    : {bytes_recv:>10} / {rnd(duration):<7} = {rnd(bytes_recv / duration):8} kB/s")
    # print(f"Data per receive : {bytes_recv:>10} / {total_recv:<7} = {rnd(bytes_recv / total_recv):8} kB/recv")
    print(f"Recv Per machine : {total_recv:>10} / {rnd(duration)} / {test_machine_num} = {rnd(total_recv / duration / test_machine_num):8} #/s per machine")

    print(f"\nDelay            : {total_delay:>10} / {total_recv:<8} = {rnd(total_delay / total_recv):8} ms/recv")


def download_logs(test_id):
    if not os.path.exists(LOG_PATH):
        os.mkdir(LOG_PATH)

    log_folder = os.path.join(LOG_PATH, str(test_id))
    
    need_download = True
    if os.path.exists(log_folder):
        yes = input(f"Is it OK to remove `./{log_folder}`?\nenter 'yes' to continue : ")
        if yes.lower() in ['y', 'yes']:
            for file in os.listdir(log_folder):
                if file.endswith('.json'):
                    os.remove(os.path.join(log_folder, file))
        else:
            need_download = False
    else:
        os.mkdir(log_folder)

    if need_download:
        process = subprocess.Popen(["aws", "s3", "sync", f"s3://together-coding-dev/test/{test_id}", f"./logs/{test_id}"])
        process.wait()


min_ts = 999999999999999999


def process_logs(test_id):
    ignore_event = ['FILE_CREATE', 'FILE_DELETE', 'FILE_UPDATE']
    def group_by_seconds(rows):
        global min_ts

        for row in rows:
            if not ("_ts_1" in row and "_ts_4" in row and "_s_emit" in row and "_c_emit" in row):
                continue
            if row['_s_emit'] in ignore_event or row['_c_emit'] in ignore_event:
                continue

            event = row["_s_emit"]
            ts = int(row["_ts_4"] / 1000)
            diff = row["_ts_4"] - row["_ts_1"]

            time_delay[event][ts] += diff
            time_delay_count[event][ts] += 1
            if min_ts > ts:
                min_ts = ts

    log_folder = os.path.join(LOG_PATH, str(test_id))
    time_delay = defaultdict(lambda : defaultdict(float))  # event_name: {timestamp: total_delay}
    time_delay_count = defaultdict(lambda : defaultdict(int))  # event_name: {timestamp: total_count}
    time_delay_avg = defaultdict(list)
    time_delay_total = defaultdict(float)
    time_delay_total_count = defaultdict(int)

    print("Reading ...")
    files = list(filter(lambda f: f.endswith('.json'), os.listdir(log_folder)))
    for idx, file in enumerate(sorted(files)):
        print(f"{idx:3}. {file}")
        if file.startswith(SUMMARY_FILE_PREFIX) or file.startswith(PROCESSED_FILE_PREFIX):
            continue

        with open(os.path.join(log_folder, file), "rt") as fp:
            group_by_seconds(json.loads(fp.read()))

    for event in time_delay.keys():
        delays: dict[float] = time_delay[event]
        counts: dict[int] = time_delay_count[event]

        tss = sorted(delays.keys())
        for ts in tss:
            time_delay_avg[event].append([ts - min_ts, round(delays[ts] / counts[ts], 2)])
            time_delay_total[ts] += delays[ts]
            time_delay_total_count[ts] += counts[ts]

        with open(os.path.join(log_folder, PROCESSED_FILE_PREFIX +event + '.json'), 'wt') as fp:
            fp.write(json.dumps(time_delay_avg[event]))

    with open(os.path.join(log_folder, PROCESSED_FILE_PREFIX + 'total.json'), 'wt') as fp:
        tss = sorted(list(time_delay_total.keys()))
        data_by_ts = [(ts-min_ts, round(time_delay_total[ts] / time_delay_total_count[ts], 2)) for ts in tss]
        fp.write(json.dumps(data_by_ts))


if __name__ == "__main__":
    parser = argparse.ArgumentParser("Perform statistical processing on K6 logs")
    parser.add_argument("test_id", type=int, help="test ID you want to process")

    args = parser.parse_args()
    test_id = args.test_id

    download_logs(test_id)

    process_summary(test_id)
    process_logs(test_id)
