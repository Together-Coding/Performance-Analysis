FROM ubuntu:22.04
RUN cd /etc/apt && sed -i 's/archive.ubuntu.com/ftp.daum.net/g' sources.list

RUN apt-get update && apt-get install -y ca-certificates gnupg2
RUN apt-get install gpg dirmngr -y

RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
RUN echo "deb https://dl.k6.io/deb stable main" | tee /etc/apt/sources.list.d/k6.list

RUN apt-get update
RUN apt-get install k6 -y
RUN apt-get install iproute2 -y

WORKDIR /home/k6

COPY . .

ENTRYPOINT ["/bin/bash", "-c", ". src/tc.sh && k6 run src/run.js"]