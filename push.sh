#/bin/bash
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin 093466323952.dkr.ecr.ap-northeast-2.amazonaws.com
docker build -t performance-test .
docker tag performance-test:latest 093466323952.dkr.ecr.ap-northeast-2.amazonaws.com/performance-test:latest
docker push 093466323952.dkr.ecr.ap-northeast-2.amazonaws.com/performance-test:latest