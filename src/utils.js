import { randomIntBetween } from "./k6_utils.js"
import { eventProb, FILE_EXT } from "./constants.js";
import { codes, words } from "./dummy.js";

export function isObject(v) {
    return typeof v === 'object' && !Array.isArray(v) && v !== null;
}

const _eventProbSum = eventProb.reduce((a, b) => a + b[1], 0)

/**
 * Return random event name of specified probability
 * @returns event name
 */
export const getEvent = () => {
    const rand = Math.random() * _eventProbSum;

    let sum = 0;
    for (let p of eventProb) {
        sum += p[1];
        if (rand < sum) {
            return p[0];
        }
    }
}

export const getRandWords = (num) => {
    if (num == null) num = randomIntBetween(5, 11 - 1);

    let list = []
    for (let i = 0; i < num; i++) {
        list.push(getRandWord())
    }
    return list.join(' ');
}

export const getRandWord = () => {
    const rand = randomIntBetween(0, words.length - 1);
    return words[rand];
}

const dirs = ['', 'a/', 'b/', 'c/']
export const getRandFileName = () => {
    return dirs[randomIntBetween(0, dirs.length - 1)] + getRandWord() + FILE_EXT;
}

export const getRandFromObjKey = (obj) => {
    return Object.keys(obj)[randomIntBetween(0, Object.keys(obj).length - 1)]
}
