# Performance test with [K6](https://k6.io/)

# Development
- Build

    `$ docker build -t performance-test .`
- Run (for local test)

    `$ docker run --rm --add-host=host.docker.internal:host-gateway -i performance-test`
- Deploy image to ECR

    `$ . push.sh`


# NAT instance
TC (traffic control) script needs to be executed in NAT instance in order to limit bandwidth of FARGATEs.

- Apply traffic control

    `$ . tc.sh  # Add qdisc, classes and filters and`
- Revoke

    `$ . tc_clear.sh`


# Result

Before executing iperf3:

```plaintext
class htb 1:4 parent 1:1 leaf 4: prio 0 rate 486080Kbit ceil 486080Kbit burst 1519b cburst 1519b
 Sent 0 bytes 0 pkt (dropped 0, overlimits 0 requeues 0)
 backlog 0b 0p requeues 0
 lended: 0 borrowed: 0 giants: 0
 tokens: 392 ctokens: 392
```

After executing iperf3 on 172.31.96.4/32 through NAT: you can see *class 1:4* is used as intended.

```plaintext
class htb 1:4 parent 1:1 leaf 4: prio 0 rate 486080Kbit ceil 486080Kbit burst 1519b cburst 1519b
 Sent 263717436 bytes 174222 pkt (dropped 120, overlimits 19094 requeues 0)
 backlog 0b 0p requeues 0
 lended: 20194 borrowed: 0 giants: 0
 tokens: 392 ctokens: 392
```

Bitrate limit is also applied:

```plaintext
ubuntu@ip-172.31.96.61:/home/ubuntu# iperf3 -c 172.31.2.221
Connecting to host 172.31.2.221, port 5201
[  5] local 172.31.96.61 port 46178 connected to 172.31.2.221 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  56.1 MBytes   471 Mbits/sec    0    306 KBytes
[  5]   1.00-2.00   sec  55.6 MBytes   467 Mbits/sec    0    306 KBytes
[  5]   2.00-3.00   sec  55.6 MBytes   467 Mbits/sec    0    306 KBytes
[  5]   3.00-4.00   sec  55.2 MBytes   463 Mbits/sec    0    306 KBytes
[  5]   4.00-5.00   sec  55.8 MBytes   468 Mbits/sec    0    402 KBytes
[  5]   5.00-6.00   sec  55.4 MBytes   465 Mbits/sec    0    402 KBytes
[  5]   6.00-7.00   sec  55.4 MBytes   465 Mbits/sec    0    402 KBytes
[  5]   7.00-8.00   sec  55.4 MBytes   465 Mbits/sec    0    402 KBytes
[  5]   8.00-9.00   sec  55.9 MBytes   469 Mbits/sec    0    402 KBytes
[  5]   9.00-10.00  sec  55.4 MBytes   465 Mbits/sec    0    402 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   556 MBytes   466 Mbits/sec    0             sender
[  5]   0.00-10.00  sec   555 MBytes   465 Mbits/sec                  receiver

iperf Done.
```