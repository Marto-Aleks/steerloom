# Reporting a security problem

Steerloom reads people's boards and code with their own tokens, so security
reports are taken seriously and handled before anything else.

## How to report

**Please do not open a public issue.** Use GitHub's private report instead:
open the **Security** tab of this repository and choose **Report a
vulnerability**. Only the maintainer can read it.

Include:

- what you found and where (the hosted site, the local app, or the installer)
- the steps to reproduce it, or a short proof of concept
- what an attacker could read or do with it

## What to expect

Steerloom has one maintainer. You will get a reply within a week, usually
sooner. Confirmed problems are fixed in the next release and credited in its
notes, unless you prefer not to be named.

## Rules for testing

- Test against your own install or your own account. The local version runs
  entirely on your computer, which makes it the right place to try things.
- Do not read, change or delete other people's data on `steerloom.app`.
- No load testing or denial of service against `steerloom.app`: it is a small
  service on one server.
- No social engineering of the maintainer or of users.

## Supported versions

Only the latest release is supported. The installed app shows "Update
available" when it is behind; the hosted site always runs the latest.
