# Blocked

## Automatic deploys on push (2026-09-17)

`vercel git connect` fails: "You need to add a Login Connection to your GitHub account first." The Vercel
account has no GitHub login connection, and only the account owner can add one.

Unblock: in Vercel, Account Settings, Authentication, connect GitHub. Then run `npx vercel git connect` in the
repo. Until then, production deploys run manually with `npx vercel deploy --prod`.
