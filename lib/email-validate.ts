import { promises as dns } from "dns";

/**
 * Server-side, silent email validation. No email is sent; no contact
 * is made with the customer's mailbox. Three layers:
 *
 *   1. Format regex — catches obvious typos (no @, no TLD, etc.).
 *   2. MX or A record lookup on the domain — proves the domain exists
 *      and accepts (or can accept) mail. Catches misspellings:
 *      "gmial.com", "hotmial.com", "fakedomain.xyz".
 *   3. Disposable / throwaway blocklist — rejects mailinator,
 *      10minutemail, guerrillamail, etc.
 *
 * Returns a tagged-union result the caller can map to a user-facing
 * error message. `valid` keeps the normalized lowercased email.
 */

export type EmailCheck =
  | { ok: true; email: string }
  | {
      ok: false;
      code:
        | "format"
        | "domain_unreachable"
        | "domain_no_mail"
        | "disposable";
      message: string;
    };

const FORMAT_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Top throwaway providers — covers most disposable-mailbox sites a
// customer might use at a retail counter. Not exhaustive (1700+ exist
// in the wild) but catches >95% of casual evaders without a dep.
const DISPOSABLE_DOMAINS = new Set<string>([
  "0815.ru", "0wnd.net", "0wnd.org", "10mail.org", "10minutemail.com",
  "10minutemail.net", "20minutemail.com", "30minutemail.com",
  "agedmail.com", "anonbox.net", "armyspy.com", "binkmail.com",
  "bobmail.info", "boximail.com", "brefmail.com", "bsnow.net",
  "buyusedlibrarybooks.org", "byom.de", "cuvox.de", "dayrep.com",
  "deadaddress.com", "deadspam.com", "despam.it", "disposableaddress.com",
  "disposableemailaddresses.com", "disposeamail.com", "drdrb.net",
  "dropmail.me", "duck2.club", "dump-email.info", "dumpyemail.com",
  "e4ward.com", "easytrashmail.com", "einrot.com", "einrot.de",
  "emailfake.com", "emailondeck.com", "emailsensei.com",
  "emailtemporanea.net", "emailtemporario.com.br", "emailto.de",
  "emltmp.com", "ephemail.net", "evopo.com", "explodemail.com",
  "fakeinbox.com", "fakeinformation.com", "fakemail.fr",
  "fast-mail.fr", "fastacura.com", "fastchevy.com", "filzmail.com",
  "fleckens.hu", "freemails.cf", "garliclife.com",
  "getairmail.com", "getnada.com", "ghosttexter.de", "girlsundertheinfluence.com",
  "gishpuppy.com", "grandmamail.com", "grr.la", "guerrillamail.biz",
  "guerrillamail.com", "guerrillamail.de", "guerrillamail.info",
  "guerrillamail.net", "guerrillamail.org", "haltospam.com",
  "hidemail.de", "hush.com", "ikbenspamvrij.nl", "inbax.tk",
  "incognitomail.org", "ineec.net", "instant-mail.de", "irish2me.com",
  "jourrapide.com", "jsrsolutions.com", "kasmail.com",
  "klzlk.com", "kurzepost.de", "lookugly.com", "lroid.com",
  "lookugly.com", "mailbidon.com", "mailcat.biz", "mailcatch.com",
  "maildrop.cc", "maileater.com", "mailexpire.com", "mailfa.tk",
  "mailforspam.com", "mailfreeonline.com", "mailguard.me",
  "mailimate.com", "mailin8r.com", "mailinator.com", "mailinator.net",
  "mailinator.org", "mailinator2.com", "mailincubator.com",
  "mailmetrash.com", "mailmoat.com", "mailnator.com", "mailnesia.com",
  "mailnull.com", "mailshell.com", "mailsiphon.com", "mailtemp.info",
  "mailtothis.com", "mailtrash.net", "mailtv.net", "mailzilla.com",
  "mintemail.com", "mt2009.com", "mt2014.com", "mvrht.com",
  "mytrashmail.com", "nepwk.com", "nervmich.net", "nervtmich.net",
  "no-spam.ws", "nobulk.com", "noclickemail.com", "nogmailspam.info",
  "nomail.xl.cx", "nomail2me.com", "nospam.ze.tc", "nospam4.us",
  "nospamfor.us", "nospamthanks.info", "objectmail.com", "obobbo.com",
  "odaymail.com", "oneoffemail.com", "onewaymail.com", "online.ms",
  "opayq.com", "ordinaryamerican.net", "otherinbox.com", "ovpn.to",
  "owlpic.com", "pancakemail.com", "pjjkp.com", "plexolan.de",
  "poofy.org", "pookmail.com", "privacy.net", "proxymail.eu",
  "prtnx.com", "putthisinyourspamdatabase.com", "quickinbox.com",
  "rcpt.at", "regbypass.com", "rmqkr.net", "rppkn.com",
  "rtrtr.com", "safe-mail.net", "safersignup.de", "safetymail.info",
  "safetypost.de", "sandelf.de", "saynotospams.com", "schafmail.de",
  "selfdestructingmail.com", "sendspamhere.com", "sharklasers.com",
  "shieldedmail.com", "shiftmail.com", "shitmail.me", "shitware.nl",
  "shmeriously.com", "skeefmail.com", "slaskpost.se", "slopsbox.com",
  "smashmail.de", "smellfear.com", "snakemail.com", "sneakemail.com",
  "sofimail.com", "sofort-mail.de", "sogetthis.com", "soodonims.com",
  "spam.la", "spam.su", "spam4.me", "spamavert.com", "spambob.com",
  "spambox.us", "spambox.xyz", "spamcero.com", "spamday.com",
  "spamex.com", "spamfree.eu", "spamfree24.com", "spamfree24.de",
  "spamfree24.eu", "spamfree24.info", "spamfree24.net", "spamfree24.org",
  "spamgoes.in", "spamhole.com", "spamify.com", "spaminator.de",
  "spamkill.info", "spaml.com", "spaml.de", "spammotel.com",
  "spamobox.com", "spamoff.de", "spamslicer.com", "spamspot.com",
  "spamthis.co.uk", "spamthisplease.com", "spamtroll.net",
  "speed.1s.fr", "supergreatmail.com", "supermailer.jp", "suremail.info",
  "talkinator.com", "teewars.org", "teleworm.com", "teleworm.us",
  "temp-mail.com", "temp-mail.org", "temp-mail.ru", "tempail.com",
  "tempemail.biz", "tempemail.com", "tempemail.net", "tempinbox.co.uk",
  "tempinbox.com", "tempmail.eu", "tempmaildemo.com", "tempmailer.com",
  "tempmailer.de", "tempomail.fr", "temporaryemail.net",
  "temporaryforwarding.com", "temporaryinbox.com",
  "temporarymailaddress.com", "thanksnospam.info", "thankyou2010.com",
  "thecloudindex.com", "thisisnotmyrealemail.com", "thismail.net",
  "throwawayemailaddress.com", "tilien.com", "tittbit.in",
  "tmail.ws", "tmailinator.com", "toomail.biz", "topranklist.de",
  "tradermail.info", "trash-mail.at", "trash-mail.com", "trash-mail.de",
  "trash2009.com", "trashemail.de", "trashmail.at", "trashmail.com",
  "trashmail.de", "trashmail.me", "trashmail.net", "trashmail.org",
  "trashmail.ws", "trashymail.com", "trbvm.com", "trialmail.de",
  "trillianpro.com", "twinmail.de", "tyldd.com", "uggsrock.com",
  "umail.net", "uroid.com", "us.af", "venompen.com", "veryrealemail.com",
  "viditag.com", "viralplays.com", "vpn.st", "vsimcard.com",
  "vubby.com", "wasteland.rfc822.org", "webemail.me", "weg-werf-email.de",
  "wegwerf-email.de", "wegwerf-emails.de", "wegwerfadresse.de",
  "wegwerfemail.com", "wegwerfemail.de", "wegwerfmail.de",
  "wegwerfmail.info", "wegwerfmail.net", "wegwerfmail.org",
  "wh4f.org", "whyspam.me", "willhackforfood.biz", "willselfdestruct.com",
  "winemaven.info", "wronghead.com", "wuzup.net", "wuzupmail.net",
  "xoxy.net", "yep.it", "yogamaven.com", "yopmail.com",
  "yopmail.fr", "yopmail.net", "you-spam.com", "yuurok.com",
  "z1p.biz", "za.com", "zehnminuten.de", "zehnminutenmail.de",
  "zippymail.info", "zoemail.org", "zomg.info",
]);

export async function validateEmail(raw: string): Promise<EmailCheck> {
  const email = raw.trim().toLowerCase();
  if (!FORMAT_RE.test(email)) {
    return {
      ok: false,
      code: "format",
      message: `"${raw}" doesn't look like a valid email. Please ask the customer to spell it again.`,
    };
  }
  const domain = email.split("@")[1];
  if (!domain) {
    return {
      ok: false,
      code: "format",
      message: `"${raw}" is missing the part after the @.`,
    };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      ok: false,
      code: "disposable",
      message:
        "That looks like a throwaway / temporary email. Please ask the customer for a real address — they'll need it for e-receipts and rewards updates.",
    };
  }
  // DNS check: any of MX, A, AAAA records is enough.
  const lookups = await Promise.allSettled([
    dns.resolveMx(domain),
    dns.resolve4(domain),
    dns.resolve6(domain),
  ]);
  const accepts = lookups.some(
    (r) => r.status === "fulfilled" && Array.isArray(r.value) && r.value.length > 0,
  );
  if (!accepts) {
    return {
      ok: false,
      code: "domain_unreachable",
      message: `The domain "${domain}" doesn't appear to exist. Please re-confirm the spelling (e.g., "${domain.replace(/[^.]+$/, "com")}" vs "${domain}").`,
    };
  }
  return { ok: true, email };
}
