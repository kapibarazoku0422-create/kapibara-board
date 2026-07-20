import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from './config.js';
import { findUserById, upsertGoogleUser } from './repository.js';

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id: string, done) => {
  try {
    done(null, (await findUserById(id)) ?? false);
  } catch (error) {
    done(error);
  }
});

if (config.googleAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleClientId!,
        clientSecret: config.googleClientSecret!,
        callbackURL: `${config.baseUrl}/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          done(null, await upsertGoogleUser(profile));
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

export { passport };
