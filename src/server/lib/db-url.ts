// Robust MySQL URL parser. Unlike the default URL parser, this splits userinfo
// from host on the LAST "@", so passwords containing "@" (or other URL-special
// characters) work without percent-encoding. The password is treated as a literal
// value (NOT percent-decoded), since users typically paste the raw password.

export interface DbConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbUrl(url: string): DbConn {
  const trimmed = url.trim();
  const proto = /^mysql(?:2)?:\/\/(.*)$/i.exec(trimmed);
  const rest = proto ? proto[1] : trimmed;

  const at = rest.lastIndexOf("@");
  if (at === -1) {
    throw new Error("Invalid DATABASE_URL: missing '@' between credentials and host.");
  }
  const userinfo = rest.slice(0, at);
  let hostpart = rest.slice(at + 1);

  const colon = userinfo.indexOf(":");
  const user = decodeURIComponent(colon === -1 ? userinfo : userinfo.slice(0, colon));
  const password = colon === -1 ? "" : userinfo.slice(colon + 1); // literal

  // hostpart: host[:port][/database][?params]
  const q = hostpart.indexOf("?");
  if (q !== -1) hostpart = hostpart.slice(0, q);
  const slash = hostpart.indexOf("/");
  const hostport = slash === -1 ? hostpart : hostpart.slice(0, slash);
  const database = slash === -1 ? "" : decodeURIComponent(hostpart.slice(slash + 1));

  const lastColon = hostport.lastIndexOf(":");
  const host = lastColon === -1 ? hostport : hostport.slice(0, lastColon);
  const port = lastColon === -1 ? 3306 : Number(hostport.slice(lastColon + 1)) || 3306;

  return { host, port, user, password, database };
}
