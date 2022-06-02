#!/bin/bash

### CMD ###
# Describe and check sent/recved size
# tc -s {qdisc|class|filter} ls dev eth0
# Delete filter by prio
# $ tc filter del dev eth0 prio {prio}

NAT_VPC="172.31.0.0/16"
NAT_SUBNET=("172.31.96.0" "172.31.96.32")
NAT_SUBNET_PREFIX=27
NAT_LAST_HOST=$(( 2 ** (32 - $NAT_SUBNET_PREFIX) ))

INTERFACE="eth0"
SPEED_UNIT="mbps"
SPEED_DOWNLOAD="60.76"  # mbps == megabytes
SPEED_UPLOAD="25.95"
DELAY=10  # ms
TC_DEFAULT=$(( ${#NAT_SUBNET[@]} * $NAT_LAST_HOST ))
TC_TOTAL_RATE=$(echo $NAT_LAST_HOST*$SPEED_DOWNLOAD | bc | awk '{printf("%.f\n", ($1)+0.5)}' )

ip -c a
ip route show

# Add root qdisc
echo ">> sudo tc qdisc add dev $INTERFACE root handle 1: htb default $TC_DEFAULT"
sudo tc qdisc add dev $INTERFACE root handle 1: htb default $TC_DEFAULT
echo ">> sudo tc class add dev $INTERFACE parent 1: classid 1:1 htb rate $TC_TOTAL_RATE"
sudo tc class add dev $INTERFACE parent 1: classid 1:1 htb rate $TC_TOTAL_RATE

# Set nat
sudo iptables -t nat -A POSTROUTING -s $NAT_VPC -j MASQUERADE

for subnet in ${NAT_SUBNET[@]}
do
    network=$(echo $subnet | tr '.' ' ' | awk '{printf("%d.%d.%d.", $1, $2, $3) }')
    host=$(echo $subnet | cut -d. -f4)

    # Ignore reserved addresses
    start=$(( host+3 ))
    end=$(( host + 2 ** (32-NAT_SUBNET_PREFIX) - 1 ))
    for ((i=start; i<=end; i++))
    do
        echo ">> sudo tc class add dev $INTERFACE parent 1:1 classid 1:${i} htb rate $SPEED_DOWNLOAD$SPEED_UNIT"
        sudo tc class add dev $INTERFACE parent 1:1 classid 1:${i} htb rate ${SPEED_DOWNLOAD}${SPEED_UNIT}

        echo ">> sudo tc filter add dev $INTERFACE protocol ip handle ${i} fw flowid 1:${i}"
        sudo tc filter add dev $INTERFACE protocol ip handle ${i} fw flowid 1:${i}
        sudo tc qdisc add dev $INTERFACE parent 1:${i} handle ${i}: netem delay ${DELAY}ms

        echo ">> iptables -t mangle -I FORWARD -s 172.31.96.${i}/32 -j MARK --set-mark ${i}"
        sudo iptables -t mangle -I FORWARD -s 172.31.96.${i}/32 -j MARK --set-mark ${i}
    done
done

# fallback
echo ">> sudo tc class add dev $INTERFACE parent 1:1 classid 1:$TC_DEFAULT htb rate ${SPEED_DOWNLOAD}${SPEED_UNIT}"
sudo tc class add dev $INTERFACE parent 1:1 classid 1:$TC_DEFAULT htb rate ${SPEED_DOWNLOAD}${SPEED_UNIT}
echo ">> sudo tc qdisc add dev $INTERFACE parent 1:$TC_DEFAULT handle $TC_DEFAULT: sfq perturb 10"
sudo tc qdisc add dev $INTERFACE parent 1:$TC_DEFAULT handle $TC_DEFAULT: sfq perturb 10
