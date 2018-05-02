import { Assets, defaultOptionsSpecs, OptionsGetter, Videobox, VideoboxContent } from '@liquid-js/videobox-core'
import * as crypto from 'crypto'
import * as stringify from 'json-stable-stringify'
import * as Koa from 'koa'
import * as bodyParser from 'koa-bodyparser'
import * as onError from 'koa-onerror'
import * as Router from 'koa-router'

export class VideoboxServer extends Koa {

    private promiseCache = {}
    public readonly router = new Router()

    constructor(
        private vbx = new Videobox({}),
        private vbc = new VideoboxContent(vbx)
    ) {
        super()
        onError(this)
        this.on('error', function (err) {
            console.log(err)
        })

        this.router.post('/parse', bodyParser(), async context => {
            const cacheKey = crypto.createHash('md5')
                .update(stringify(context.request.body))
                .digest('hex')

            return this.cached(context, cacheKey, 'application/json', async ctx => {
                const body = ctx.request.body
                const options = OptionsGetter.parseOptions(defaultOptionsSpecs, Object.assign({}, this.vbx.options, body.options))
                const code = body.code || ''

                return new Videobox(options, this.vbx.encoder, this.vbx.adapters).parse(code)
            })
        })

        this.router.get(/\/thumbnail\/(.*)\.jpg/, async context => {
            const cacheKey = crypto.createHash('md5')
                .update('thumbnail')
                .update(context.params[0])
                .digest('hex')

            return this.cached(context, cacheKey, 'image/jpeg', async ctx => this.vbc.thumbnail(ctx.params[0]))
        })

        this.router.get(/\/embed\/(.*)/, async context => {
            const options = OptionsGetter.parseOptions(defaultOptionsSpecs, Object.assign({}, this.vbx.options, {
                color: (context.query || {}).color
            }))

            const cacheKey = crypto.createHash('md5')
                .update('embed')
                .update(context.params[0])
                .update(options.color)
                .digest('hex')

            return this.cached(context, cacheKey, 'text/html', async ctx => this.vbc.embed(ctx.params[0], options.color))
        })

        this.router.get('/assets/player.js', async ctx => {
            const cacheKey = crypto.createHash('md5')
                .update('playerJS')
                .digest('hex')

            return this.cached(ctx, cacheKey, 'application/javascript', async _ctx => Assets.getPlayerJS())
        })

        this.router.get(/\/assets\/player-([a-fA-F0-9]{6}).css/, async ctx => {
            const options = {
                color: ctx.params[0] || ''
            }
            OptionsGetter.parseOptions({
                color: { type: 'rgb', default: '50bf82' }
            }, options)

            const cacheKey = crypto.createHash('md5')
                .update('playerCSS')
                .update(options.color)
                .digest('hex')

            return this.cached(ctx, cacheKey, 'text/css', async _ctx => Assets.getPlayerCSS(options.color))
        })

        this.router.get('/assets/player.svg', async ctx => {
            const cacheKey = crypto.createHash('md5')
                .update('playerSVG')
                .digest('hex')

            return this.cached(ctx, cacheKey, 'image/svg+xml', async _ctx => Assets.getPlayerSVG())
        })

        this.use(async (ctx, next) => {
            try {
                await next()
            } catch (e) {
                console.error(e)
                ctx.set('Content-Type', 'application/json')
                ctx.body = JSON.stringify(e && e.toString ? e.toString() : `${e}`)
            }

            if (!ctx.body) {
                ctx.set('Content-Type', 'text/html')
                ctx.body = 'Not found'
                ctx.status = 404
            }
        })

        this.use(this.router.routes())
    }

    async cached(ctx: Koa.Context, cacheKey: string, contentType: string, resolver: (ctx: Koa.Context) => any) {
        const cachedVal = await this.vbc.cache.get(cacheKey)

        if (cachedVal) {
            ctx.set('Content-Type', contentType)
            ctx.body = cachedVal
            return
        }

        if (!(cacheKey in this.promiseCache))
            this.promiseCache[cacheKey] = Promise.resolve(resolver(ctx))

        const content = await this.promiseCache[cacheKey]

        this.vbc.cache.set(cacheKey, content, 15 * 60)
            .catch(err => console.log(err))

        ctx.set('Content-Type', contentType)
        ctx.body = content
    }
}
