const crypto = require('crypto');
const { encode } = require('gpt-3-encoder');
const openai = require('./openai');
const cache = require('../cache');
function buildHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function createCompletion({
  prompt,
  max_tokens = 1024,
  temperature = 0,
}) {
  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    max_tokens,
    temperature,
  });
  return strip(completion?.data?.choices?.[0].text, ['\n']).trim();
}

// Видалити вказані символи на початку та в кінці
const strip = (str, chars) => {
  let newStr = str;
  chars.forEach(char => {
    newStr = newStr.replace(new RegExp(`^${char}+|${char}+$`, 'g'), '');
  });
  return newStr;
};
const withCache =
  (wrappedFn, suffix, getContent) => async (arg, cacheFileName) => {
    const content = getContent(arg);
    const cacheName = `${cacheFileName}_${suffix}`;
    // Текст задовгий, будь-ласка, слід відсікти його
    const hash = buildHash(content);
    const cacheValue = cache.get(cacheName, hash);
    if (cacheValue) {
      return cacheValue;
    }
    const rs = await wrappedFn(arg);
    cache.set(cacheName, hash, rs);
    return rs;
  };

async function getSummary({ content, tokenLength }) {
  const promptContext =
    content.indexOf('|上文中a:') >= -1
      ? `'''{{content}}'''Перекладайте на основі словника та повертайте короткий виклад вмісту：`
      : `'''{{content}}'''Побудова резюмації вмісту на основі розпізнавання іменованих сутностей：`;
  const contentTokenLength = tokenLength || encode(content).length;
  const promptContextTokenLength = encode(promptContext).length;
  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: promptContext.replace('{{content}}', content),
    // 1000 ~ 4096，Максимум не може перевищувати 1000
    max_tokens: Math.min(
      4096 - contentTokenLength - promptContextTokenLength,
      1000,
    ),
    temperature: 0,
  });
  return strip(completion?.data?.choices?.[0].text, ['\n']);
}

async function createEmbedding(input) {
  const [response] = await Promise.all([
    openai.createEmbedding({
      model: 'text-embedding-ada-002',
      input: input,
    }),
    // Векторизація швидка, зробіть перерву, щоб запобігти переповненню виклику (за замовчуванням до 60 разів на хвилину)
    await sleep(3000),
  ]);
  return response.data.data[0].embedding;
}

async function askInsQuestion({ question, knowledge }) {
  const prompt = `
    Нижче наведено частину умов страхового продукту
    '''${knowledge}'''
    Будь ласка, дайте відповіді на наступні питання, виходячи з вашого розуміння страхування та змісту цієї частини умов：
    ${question}。
    Відповідь：
    `;
  const promptTokenLength = encode(prompt).length;
  return createCompletion({ prompt, max_tokens: 4096 - promptTokenLength });
}
// Запобігайте перевищенню ліміту дзвінків за хвилину
const sleep = time =>
  new Promise(resolve => {
    setTimeout(resolve, time);
  });

module.exports = {
  sleep,
  getSummary,
  getSummaryWithCache: withCache(
    getSummary,
    'summary',
    ({ content }) => content,
  ),
  createEmbeddingWithCache: withCache(
    createEmbedding,
    'embedding',
    input => input,
  ),
  askInsQuestion,
  createCompletion,
};
