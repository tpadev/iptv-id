import { File, Storage } from '../../core'
import { Stream, Category, Channel, Language, Country, Region, Subdivision } from '../../models'
import { Database } from '../../core/database'
import { Collection } from '../../core/collection'
import { Logger } from '../../core/logger'
import _ from 'lodash'
import {
  CategoriesGenerator,
  CountriesGenerator,
  LanguagesGenerator,
  RegionsGenerator,
  IndexGenerator,
  IndexNsfwGenerator,
  IndexCategoryGenerator,
  IndexCountryGenerator,
  IndexLanguageGenerator,
  IndexRegionGenerator
} from '../../generators'
import { DATA_DIR, DB_DIR, LOGS_DIR } from '../../constants'

async function main() {
  const logger = new Logger()

  const storage = new Storage(DATA_DIR)

  const channelsContent = await storage.json('channels.json')
  const channels = new Collection(channelsContent).map(data => new Channel(data))

  const categoriesContent = await storage.json('categories.json')
  const categories = new Collection(categoriesContent).map(data => new Category(data))

  const countriesContent = await storage.json('countries.json')
  const countries = new Collection(countriesContent).map(data => new Country(data))

  const languagesContent = await storage.json('languages.json')
  const languages = new Collection(languagesContent).map(data => new Language(data))

  const regionsContent = await storage.json('regions.json')
  const regions = new Collection(regionsContent).map(data => new Region(data))

  const subdivisionsContent = await storage.json('subdivisions.json')
  const subdivisions = new Collection(subdivisionsContent).map(data => new Subdivision(data))

  const streams = await loadStreams({ channels, categories, languages })

  const generatorsLogger = new Logger({
    stream: await new Storage(LOGS_DIR).createStream(`generators.log`)
  })

  logger.info('generating categories/...')
  await new CategoriesGenerator({ categories, streams, logger: generatorsLogger }).generate()

  logger.info('generating countries/...')
  await new CountriesGenerator({
    countries,
    streams,
    regions,
    subdivisions,
    logger: generatorsLogger
  }).generate()

  logger.info('generating languages/...')
  await new LanguagesGenerator({ streams, logger: generatorsLogger }).generate()

  logger.info('generating regions/...')
  await new RegionsGenerator({
    streams,
    regions,
    subdivisions,
    logger: generatorsLogger
  }).generate()

  logger.info('generating index.m3u...')
  await new IndexGenerator({ streams, logger: generatorsLogger }).generate()

  logger.info('generating index.nsfw.m3u...')
  await new IndexNsfwGenerator({ streams, logger: generatorsLogger }).generate()

  logger.info('generating index.category.m3u...')
  await new IndexCategoryGenerator({ streams, logger: generatorsLogger }).generate()

  logger.info('generating index.country.m3u...')
  await new IndexCountryGenerator({
    streams,
    countries,
    regions,
    subdivisions,
    logger: generatorsLogger
  }).generate()

  logger.info('generating index.language.m3u...')
  await new IndexLanguageGenerator({ streams, logger: generatorsLogger }).generate()

  logger.info('generating index.region.m3u...')
  await new IndexRegionGenerator({ streams, regions, logger: generatorsLogger }).generate()
}

main()

async function loadStreams({
  channels,
  categories,
  languages
}: {
  channels: Collection
  categories: Collection
  languages: Collection
}) {
  const groupedChannels = channels.keyBy(channel => channel.id)
  const groupedCategories = categories.keyBy(category => category.id)
  const groupedLanguages = languages.keyBy(language => language.code)

  const db = new Database(DB_DIR)
  const dbStreams = await db.load('streams.db')
  const docs = await dbStreams.find({})
  const streams = new Collection(docs as any[])
    .map((data: any) => new Stream(data))
    .orderBy([(stream: Stream) => stream.channel, (stream: Stream) => stream.url], ['asc', 'asc'])
    .uniqBy((stream: Stream) => stream.channel || _.uniqueId())
    .map((stream: Stream) => {
      const channel: Channel | undefined = groupedChannels.get(stream.channel)

      if (channel) {
        const channelCategories = channel.categories
          .map((id: string) => groupedCategories.get(id))
          .filter(Boolean)
        const channelLanguages = channel.languages
          .map((id: string) => groupedLanguages.get(id))
          .filter(Boolean)

        stream.categories = channelCategories
        stream.languages = channelLanguages
        stream.broadcastArea = channel.broadcastArea
        stream.isNSFW = channel.isNSFW
        if (channel.logo) stream.logo = channel.logo
      } else {
        const file = new File(stream.filepath)
        const [_, countryCode] = file.getFilename().match(/^([a-z]{2})(_|$)/) || [null, null]
        const defaultBroadcastArea = countryCode ? [`c/${countryCode.toUpperCase()}`] : []

        stream.broadcastArea = new Collection(defaultBroadcastArea)
      }

      return stream
    })

  return streams
}