'use strict';

const superagent = require('superagent');
const koaBody = require('koa-body');
const koaLogger = require('koa-logger');
const superagentLogger = require('superagent-logger');
const Router = require('koa-router');
const Koa = require('koa');
const crypto = require('crypto');
const level = require('level');

const settings = {
    HEROKU_OAUTH_ID: 'a67ab9f5-68be-4980-b148-8f7f63062960',
    HEROKU_OAUTH_SECRET: 'b10c8220-0560-45b6-bc37-e65b8f6aa5db',
    HEROKU_SCOPES: 'global',
    LISTEN_PORT: 8080,
};

const app = new Koa();
const router = new Router();
const agent = superagent.agent().use(superagentLogger);
const sessions = level('sessions');

const main = async () => {

    router.use(async (ctx, next) => {
        ctx.state.csrf = ctx.cookies.get('csrf');
        if (!ctx.state.csrf) {
            ctx.state.csrf = crypto.randomBytes(20).toString('hex');
            ctx.cookies.set('csrf', ctx.state.csrf);
        }
        return next();
    });

    router.use(async (ctx, next) => {
        ctx.state.session = ctx.cookies.get('session');
        if (!ctx.state.session) {
            ctx.state.session = crypto.randomBytes(20).toString('hex');
            ctx.cookies.set('session', ctx.state.session);
        }
        let rawSession = undefined;
        try {
            rawSession = await sessions.get(ctx.state.session);
            ctx.session = JSON.parse(rawSession);
        } catch (err) {
            if (err.notFound) {
                console.log('Session ID miss', ctx.state.session);
                ctx.session = {};
            } else {
                throw err;
            }
        }
        try {
            return await next();
        } finally {
            const newSession = JSON.stringify(ctx.session);
            if (rawSession !== newSession) {
                console.log('Updated session', ctx.state.session);
                await sessions.put(ctx.state.session, newSession);
            }
        }
    });

    router.get('/', ctx => {
        ctx.body = {
            state: 'Online',
            url: router.stack
                .filter(route => route.methods && route.methods.length > 0)
                .map(route => route.methods
                    .map(method => ({ method, path: route.path }))
                ),
        };
    });

    router.get('/oauth/authorize', ctx => {
        ctx.redirect(`https://id.heroku.com/oauth/authorize?client_id=${settings.HEROKU_OAUTH_ID}&response_type=code&scope=${settings.HEROKU_SCOPES}&state=${ctx.state.csrf}`);
    });

    router.get('/oauth/callback', async (ctx) => {

        const resp = await agent
            .post('https://id.heroku.com/oauth/token')
            .query({
                grant_type: 'authorization_code',
                code: ctx.query.code,
                client_secret: settings.HEROKU_OAUTH_SECRET,
            });

        ctx.session.heroku = resp.body;

        ctx.redirect('/me');
    });

    router.get('/me', async ctx => {
        const resp = await agent.get('https://api.heroku.com/account')
            .set('Accept', 'application/vnd.heroku+json; version=3')
            .set('Authorization', `Bearer ${ctx.session.heroku.access_token}`);
        ctx.body = resp.body;
    });

    await new Promise(resolve => app
        .use(async (ctx, next) => {
            try {
                return await next();
            } catch (err) {
                console.log(err);
                ctx.status = err.status || err.statusCode || 500;
                ctx.body = {
                    status: ctx.status,
                    message: err.message || 'Something went wrong!',
                    error: err.json || err,
                };
                console.log(ctx.status, ctx.body);
            }
        })
        .use(koaLogger())
        .use(koaBody())
        .use(router.routes())
        .use(router.allowedMethods())
        .listen(settings.LISTEN_PORT, function () {
            console.log('listening on', this.address());
            return resolve();
        }));
};
if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(-1);
    });
}

module.exports = main;
