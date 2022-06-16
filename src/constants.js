export const EVENT_RATE = 2  // emit num by 1 seconds

// Periodically emitted events
export const EV_DIR_INFO = "DIR_INFO"  // 파일리스트
export const EV_FILE_READ = "FILE_READ" // 파일 열기
export const EV_CURSOR_MOVE = "CURSOR_MOVE" // 커서 위치 변경 

export const EV_FILE_MOD = "FILE_MOD" // 코드 수정 공유 
export const EV_FILE_SAVE = "FILE_SAVE" // 코드 저장 

export const EV_FEEDBACK_ADD = "FEEDBACK_ADD" // 피드백 생성
export const EV_FEEDBACK_COMMENT = "FEEDBACK_COMMENT" // 피드백 댓글 작성

// Non-periodic emitted events
export const EV_ECHO = "echo"
export const EV_TIMESTAMP_ACK = "TIMESTAMP_ACK"
export const EV_TIME_SYNC = "TIME_SYNC"
export const EV_TIME_SYNC_ACK = "TIME_SYNC_ACK"
export const EV_INIT_LESSON = "INIT_LESSON"

export const EV_ACTIVITY_PING = "ACTIVITY_PING"  // send only
export const EV_ALL_PARTICIPANT = "ALL_PARTICIPANT"
export const EV_PARTICIPANT_STATUS = "PARTICIPANT_STATUS"  // recv only
export const EV_PROJECT_ACCESSIBLE = "PROJECT_ACCESSIBLE"

// Additional periodic events
export const EV_FILE_CREATE = "FILE_CREATE"
export const EV_FILE_UPDATE = "FILE_UPDATE"
export const EV_FILE_DELETE = "FILE_DELETE"
export const EV_FEEDBACK_LIST = "FEEDBACK_LIST"

export const eventProb = [
    [EV_DIR_INFO, 7],
    [EV_FILE_READ, 10],
    [EV_CURSOR_MOVE, 40],
    [EV_FILE_MOD, 30],
    [EV_FILE_SAVE, 10],
    [EV_FEEDBACK_ADD, 0.5],
    [EV_FEEDBACK_COMMENT, 2.5],
    // Additional
    [EV_FILE_CREATE, 0.01],
    [EV_FILE_UPDATE, 0.01],
    [EV_FILE_DELETE, 0.01],
]

export const FILE_EXT = ".py"