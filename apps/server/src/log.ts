import { pino } from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.logLevel,
  transport: config.prettyLogs ? { target: 'pino-pretty' } : undefined,
})

export type Logger = typeof logger
