import createLogger, { LogLevelNames } from 'console-log-level'

const level: LogLevelNames = 'info'

export const log = createLogger({ level })
