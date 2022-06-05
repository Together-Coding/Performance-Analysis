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
DELAY_METRIC_PREFIX = "DELAY_"
RECV_METRIC_PREFIX = "RECV_"
SEND_METRIC_PREFIX = "SEND_"

EV_FILE_MOD = "FILE_MOD"


def filepath(v):
    return os.path.join(LOG_PATH, v)


def rnd(v, prec=2):
    return round(v, prec)


def main():
    summary_files = []
    # log_files = []

    print("Reading ...")
    for idx, file in enumerate(sorted(os.listdir(LOG_PATH))):
        print(f"{idx:3}. {file}")
        with open(filepath(file), "rt") as fp:
            content = json.loads(fp.read())
            if file.startswith(SUMMARY_FILE_PREFIX):
                summary_files.append(content)
            # else:
            #     log_files.append(content)

    ws_msgs_sent = 0  # kB
    ws_msgs_received = 0  # kB

    recv_counter = defaultdict(int)  # recv count
    send_counter = defaultdict(int)  # send count
    delay_counter = defaultdict(float)  # delay time in milliseconds
    duration = 0  # max duration
    total_recv = 0
    total_send = 0
    total_delay = 0.0

    for summary in summary_files:
        metrics: dict = summary["metrics"]
        ws_msgs_sent += metrics["ws_msgs_sent"]["values"]["count"]
        ws_msgs_received += metrics["ws_msgs_received"]["values"]["count"]
        duration_ = metrics["ws_session_duration"]["values"]["max"]
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

    duration_sec = duration / 1000
    test_machine_num = len(summary_files)
    print("\n# Summary")
    print(f"\nTest Machine Num : {test_machine_num:>10}")

    print(f"Sent Event       : {total_send:>10} / {rnd(duration_sec):<7} = {rnd(total_send / duration_sec):8} #/s")
    print(f"Sent Data        : {ws_msgs_sent:>10} / {rnd(duration_sec):<7} = {rnd(ws_msgs_sent / duration_sec):8} kB/s")
    print(f"Data per send    : {ws_msgs_sent:>10} / {total_send:<7} = {rnd(ws_msgs_sent / total_send):8} kB/send")
    print(f"Sent Per machine : {total_send:>10} / {rnd(duration_sec)} / {test_machine_num} = {rnd(total_send / duration_sec / test_machine_num):8} #/s per machine")

    print(f"Received Event   : {total_recv:>10} / {rnd(duration_sec):<7} = {rnd(total_recv / duration_sec):8} #/s")
    print(f"Received Data    : {ws_msgs_received:>10} / {rnd(duration_sec):<7} = {rnd(ws_msgs_received / duration_sec):8} kB/s")
    print(f"Data per receive : {ws_msgs_received:>10} / {total_recv:<7} = {rnd(ws_msgs_received / total_recv):8} kB/recv")
    print(f"Received Per     : {total_recv:>10} / {rnd(duration_sec)} / {test_machine_num} = {rnd(total_recv / duration_sec / test_machine_num):8} #/s per machine")

    print(f"Delay            : {total_delay:>10} / {total_recv:<7} = {rnd(total_delay / total_recv):8} ms/recv")


def download_logs():
    yes = input("Is it OK to remove `./logs`?\nenter 'yes' to continue : ")
    if yes == "yes" or yes == "y":
        for file in os.listdir(LOG_PATH):
            os.remove(filepath(file))
    if not os.path.exists(LOG_PATH):
        os.mkdir(LOG_PATH)

    process = subprocess.Popen(["aws", "s3", "sync", f"s3://together-coding-dev/test/{test_id}", "./logs"])
    process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser("Perform statistical processing on K6 logs")
    parser.add_argument("test_id", type=int, help="test ID you want to process")

    args = parser.parse_args()
    test_id = args.test_id

    download_logs()

    main()
