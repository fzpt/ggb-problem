// Better Auth configuration for Express + SQLite.
const { betterAuth } = require("better-auth");
const { genericOAuth } = require("better-auth/plugins");
const Database = require("better-sqlite3");
const path = require("node:path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");

// Reuse the same better-sqlite3 database instance so Better Auth tables
// live alongside the existing `problems` table.
const authDb = new Database(DB_PATH);

// Helpers for WeChat's non-standard OAuth2 flow.
function wechatEmail(openid) {
  return `${openid}@wechat.local`;
}

async function wechatGetToken({ code, redirectURI }) {
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.errcode) {
    const err = new Error(data.errmsg || `WeChat token error ${data.errcode}`);
    err.code = data.errcode;
    throw err;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
    openid: data.openid,
    unionid: data.unionid,
  };
}

const auth = betterAuth({
  appName: "geogebra-command-builder",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
 trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",") || [
   "http://localhost:3000",
   "http://localhost:5173",
 ],
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",") || [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
  ],
 advanced: {
   database: { generateId: "uuid" },
   generateId: { uuid: { version: "v4" } },
 },
  advanced: {
    database: { generateId: "uuid" },
  },
 database: authDb,
  emailAndPassword: {
    enabled: true,
  },
 user: {
    additionalFields: {
      activeProblemId: {
        type: "string",
        required: false,
        defaultValue: null,
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "wechat",
          name: "WeChat",
          accountIssuer: "wechat",
          clientId: process.env.WECHAT_APP_ID,
          clientSecret: process.env.WECHAT_APP_SECRET,
          authorizationUrl:
            "https://open.weixin.qq.com/connect/qrconnect",
          tokenUrl: "https://api.weixin.qq.com/sns/oauth2/access_token",
          userInfoUrl: "https://api.weixin.qq.com/sns/userinfo",
          scopes: ["snsapi_login"],
          redirectURI: `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/api/auth/callback/wechat`,
          getToken: wechatGetToken,
          accountSubject: ({ profile }) => profile.openid,
          mapProfileToUser: ({ profile }) => ({
            email: wechatEmail(profile.openid),
            emailVerified: true,
            name: profile.nickname || "WeChat User",
            image: profile.headimgurl || null,
          }),
        },
      ],
    }),
  ],
});

module.exports = { auth, authDb };
