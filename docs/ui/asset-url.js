// The Pages build fills this table. The local server serves the original URLs.
const versions = /* pages:media-versions */ {};

export function assetUrl(path) {
  const urlEnd = path.indexOf('#');
  const fragment = urlEnd < 0 ? '' : path.slice(urlEnd);
  const url = urlEnd < 0 ? path : path.slice(0, urlEnd);
  const queryStart = url.indexOf('?');
  const pathname = queryStart < 0 ? url : url.slice(0, queryStart);
  if (!Object.hasOwn(versions, pathname)) return path;

  const params = new URLSearchParams(queryStart < 0 ? '' : url.slice(queryStart + 1));
  params.delete('v');
  params.set('gf', versions[pathname]);
  return pathname + '?' + params + fragment;
}
