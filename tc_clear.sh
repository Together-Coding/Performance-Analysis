#!/bin/bash

iptables -F -t nat
iptables -F -t mangle

tc qdisc del dev eth0 root handle 1: