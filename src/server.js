export const getTaskArn = (http, is_fargate, metadata_task_url) => {
    if (is_fargate) {
        let metadataResp = http.get(metadata_task_url)
        let metadata = JSON.parse(metadataResp.body)
        return metadata.TaskARN
    } else {
        return '127.0.0.1'
    }
}
