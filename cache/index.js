const { existsSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const getPath = name => join(__dirname, `./files/${name}.json`);
const getJson = path => {
  // не існує, повертає порожній об'єкт
  if (!existsSync(path)) {
    return {};
  }
  // читати файл
  let string = readFileSync(path).toString();
  let cacheJson = {};
  try {
    //десеріалізація
    cacheJson = JSON.parse(string);
  } catch {}
  return cacheJson;
};

function get(name, key) {
  const path = getPath(name);
  const json = getJson(path);
  return json[key];
}

function set(name, key, value) {
  const path = getPath(name);
  const json = getJson(path);
  json[key] = value;
  writeFileSync(path, JSON.stringify(json));
}

module.exports = { get, set };
