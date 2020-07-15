// @flow

import { Event, Team, User } from "../models";

import { OAuth2Client } from "google-auth-library";
import Router from "koa-router";
import Sequelize from "sequelize";
import auth from "../middlewares/authentication";
import addHours from "date-fns/add_hours";
import { getCookieDomain } from "../../shared/utils/domains";
import { capitalize } from "lodash";
import crypto from "crypto";
import fetch from 'isomorphic-fetch';
import { ClientCredentials, ResourceOwnerPassword, AuthorizationCode } from 'simple-oauth2';
import { Issuer } = from 'openid-client';

const Op = Sequelize.Op;
const router = new Router();

const client = new AuthorizationCode({
    client: {
      id: process.env.OAUTH_CLIENT_ID,
      secret: process.env.OAUTH_CLIENT_SECRET,
    },
    auth: {
      tokenHost: process.env.OAUTH_TOKEN_HOST,
      tokenPath: process.env.OAUTH_TOKEN_PATH,
      authorizePath: process.env.OAUTH_AUTHORIZE_PATH,
    },
});

router.get("oauth", async ctx => {
    // Generate the url that will be used for the consent dialog.
    const issuer = await Issuer.discover('https://accounts.google.com');
    
    const state = Math.random()
    .toString(36)
    .substring(7);

    ctx.cookies.set("state", state, {
      httpOnly: false,
      expires: addHours(new Date(), 1),
      domain: getCookieDomain(ctx.request.hostname),
    });

    const authorizeUrl = client.authorizeURL({
      redirect_uri: `${process.env.URL}/auth/oauth.callback`,
      access_type: "offline",
      state: state,
      scope: process.env.OAUTH_SCOPES.split(","),
      prompt: "consent",
    });
    ctx.redirect(authorizeUrl);
});

// signin callback from Google
router.get("oauth.callback", auth({ required: false }), async ctx => {
    const { code, error, state } = ctx.request.query;
    ctx.assertPresent(code || error, "code is required");
    ctx.assertPresent(state, "state is required");
  
    if (state !== ctx.cookies.get("state")) {
      ctx.redirect("/?notice=auth-error&error=state_mismatch");
      return;
    }
    if (error) {
      ctx.redirect(`/?notice=auth-error&error=${error}`);
      return;
    }
  
    console.log(`${process.env.OAUTH_TOKEN_HOST}${process.env.OAUTH_OID_PROFILE}`, code);
    const endpoint = `${process.env.OAUTH_TOKEN_HOST}${process.env.OAUTH_OID_PROFILE}`;
    const text = await (await fetch(endpoint, {
        headers: {
        "Authorization": `Bearer ${code}`
      }
    })).text();
    
    
    console.log(text)
    const data = JSON.parse(text);
  
    const [team, isFirstUser] = await Team.findOrCreate({
      where: {
        oauthId: process.env.OAUTH_NAME,
      },
      defaults: {
        name: process.env.OAUTH_NAME,
        avatarUrl: process.env.OAUTH_AVATAR_URL,
      },
    });
  
    try {
      const isFirstSignin = (await User.findOne({})) != null;
      const [user] = await User.findOrCreate({
        where: {
          [Op.or]: [
            {
              service: process.env.OAUTH_NAME,
              serviceId: data.sub
            },
            {
              service: { [Op.eq]: null },
              email: data.email,
            },
          ],
          teamId: team.id,
        },
        defaults: {
          service: process.env.OAUTH_NAME,
          serviceId: data.sub,
          name: data.name,
          email: data.email,
          isAdmin: isFirstUser,
          avatarUrl: data.profile,
        },
      });
  
      // // update the user with fresh details if they just accepted an invite
      // if (!user.serviceId || !user.service) {
      //   await user.update({
      //     service: null,
      //     serviceId: null,
      //     avatarUrl: data.picture,
      //   });
      // }
  
      // update email address if it's changed in Slack
      if (!isFirstSignin && data.user.email !== user.email) {
        await user.update({ email: data.email });
      }
  
      if (isFirstUser) {
        await team.provisionFirstCollection(user.id);
        await team.provisionSubdomain(data.team.domain);
      }
  
      if (isFirstSignin) {
        await Event.create({
          name: "users.create",
          actorId: user.id,
          userId: user.id,
          teamId: team.id,
          data: {
            name: user.name,
            service: null,
          },
          ip: ctx.request.ip,
        });
      }
  
      // set cookies on response and redirect to team subdomain
      ctx.signIn(user, team, "oauth", isFirstSignin);
    } catch (err) {
      if (err instanceof Sequelize.UniqueConstraintError) {
        const exists = await User.findOne({
          where: {
            service: "email",
            email: data.email,
            teamId: team.id,
          },
        });
  
        if (exists) {
          ctx.redirect(`${team.url}?notice=email-auth-required`);
        } else {
          ctx.redirect(`${team.url}?notice=auth-error`);
        }
  
        return;
      }
  
      throw err;
    }
});
  
export default router;
