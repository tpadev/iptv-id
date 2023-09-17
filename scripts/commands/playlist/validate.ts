import { Logger, Storage, PlaylistParser, Collection, File, Dictionary } from '../../core'
import { Channel, Stream, Blocked } from '../../models'
import { program } from 'commander'
import chalk from 'chalk'
import { transliterate } from 'transliteration'
import _ from 'lodash'
import { DATA_DIR, STREAMS_DIR } from '../../constants'
import path from 'path'

program.argument('[filepath]', 'Path to file to validate').parse(process.argv)

type LogItem = {
  type: string
  line: number
  message: string
}

async function main() {
  const logger = new Logger()

  logger.info(`loading blocklist...`)
  const storage = new Storage(DATA_DIR)
  const channelsContent = await storage.json('channels.json')
  const channels = new Collection(channelsContent).map(data => new Channel(data))
  const blocklistContent = await storage.json('blocklist.json')
  const blocklist = new Collection(blocklistContent).map(data => new Blocked(data))

  logger.info(`found ${blocklist.count()} records`)

  let errors = new Collection()
  let warnings = new Collection()
  const streamsStorage = new Storage(STREAMS_DIR)
  const parser = new PlaylistParser({ storage: streamsStorage })
  const files = program.args.length ? program.args : await streamsStorage.list('**/*.m3u')
  for (const filepath of files) {
    const file = new File(filepath)
    if (file.extension() !== 'm3u') continue

    const [, countryCode] = file.basename().match(/([a-z]{2})(|_.*)\.m3u/i) || [null, '']

    const log = new Collection()
    const buffer = new Dictionary()
    try {
      const relativeFilepath = filepath.replace(path.normalize(STREAMS_DIR), '')
      const playlist = await parser.parse(relativeFilepath)
      playlist.streams.forEach((stream: Stream) => {
        const channelNotInDatabase =
          stream.channel && !channels.first((channel: Channel) => channel.id === stream.channel)
        if (channelNotInDatabase) {
          log.add({
            type: 'warning',
            line: stream.line,
            message: `"${stream.channel}" is not in the database`
          })
        }

        const alreadyOnPlaylist = stream.url && buffer.has(stream.url)
        if (alreadyOnPlaylist) {
          log.add({
            type: 'warning',
            line: stream.line,
            message: `"${stream.url}" is already on the playlist`
          })
        } else {
          buffer.set(stream.url, true)
        }

        const channelId = generateChannelId(stream.name, countryCode)
        const blocked = blocklist.first(
          blocked =>
            stream.channel.toLowerCase() === blocked.channel.toLowerCase() ||
            channelId.toLowerCase() === blocked.channel.toLowerCase()
        )
        if (blocked) {
          log.add({
            type: 'error',
            line: stream.line,
            message: `"${stream.name}" is on the blocklist due to claims of copyright holders (${blocked.ref})`
          })
        }
      })
    } catch (error) {
      log.add({
        type: 'error',
        line: 0,
        message: error.message.toLowerCase()
      })
    }

    if (log.notEmpty()) {
      logger.info(`\n${chalk.underline(filepath)}`)

      log.forEach((logItem: LogItem) => {
        const position = logItem.line.toString().padEnd(6, ' ')
        const type = logItem.type.padEnd(9, ' ')
        const status = logItem.type === 'error' ? chalk.red(type) : chalk.yellow(type)

        logger.info(` ${chalk.gray(position)}${status}${logItem.message}`)
      })

      errors = errors.concat(log.filter((logItem: LogItem) => logItem.type === 'error'))
      warnings = warnings.concat(log.filter((logItem: LogItem) => logItem.type === 'warning'))
    }
  }

  logger.error(
    chalk.red(
      `\n${
        errors.count() + warnings.count()
      } problems (${errors.count()} errors, ${warnings.count()} warnings)`
    )
  )

  if (errors.count()) {
    process.exit(1)
  }
}

main()

function generateChannelId(name: string, code: string) {
  if (!name || !code) return ''

  name = name.replace(/ *\([^)]*\) */g, '')
  name = name.replace(/ *\[[^)]*\] */g, '')
  name = name.replace(/\+/gi, 'Plus')
  name = name.replace(/[^a-z\d]+/gi, '')
  name = name.trim()
  name = transliterate(name)
  code = code.toLowerCase()

  return `${name}.${code}`
}