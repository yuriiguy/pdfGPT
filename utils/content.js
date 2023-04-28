const path = require('path');
const nodejieba = require('nodejieba');
const LETTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZαβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.split('');
nodejieba.load({
  userDict: path.join(__dirname, '../userdict.utf8'),
});
// Вирішуйте, чи є це впровадження хвороби
function isDiseaseIntro(tokenLength, joinedContent) {
  // Якщо коротше, то не вийде
  if (tokenLength < 2000) {
    return false;
  }
  // грубе просте судження
  return !!['Основні хвороби', 'Захворювання середньої тяжкості', 'легке захворювання', 'Специфічні серцево-судинні і цереброваскулярні захворювання'].find(
    disease => joinedContent.indexOf(disease) === 0,
  );
}
// Інформація про введення хвороби занадто довга, її потрібно каструвати, а деталі введення хвороби викинуті
function shortenDiseaseIntro(content) {
  const titleRegExp = /(?=（[0-9]+）)/g;
  const sections = content.split(titleRegExp).map(section => {
    if (titleRegExp.test(section)) {
      const [title, ..._] = section.split(' ');
      return title;
    }
    return section;
  });
  return sections.join('');
}

function shortenByDictionary(originContent, words, should) {
  let shortContent = originContent;
  const dictionary = [];
  const wordsCounts = words.reduce((acc, cur) => {
    acc[cur] = (acc[cur] || 0) + 1;
    return acc;
  }, {});

  Object.keys(wordsCounts).forEach(word => {
    if (should(wordsCounts[word], word.length)) {
      dictionary.push(word);
      shortContent = shortContent.replaceAll(
        word,
        `${LETTERS[dictionary.length - 1]}`,
      );
    }
  });
  shortContent = `${shortContent}|上文中，${dictionary.map(
    (word, index) => `${LETTERS[index]}:${word}`,
  )}`;
  return shortContent;
}

function shortenTableContent(tableContent) {
  const words = tableContent.split(' ');
  return shortenByDictionary(
    tableContent,
    words,
    (counts, length) => counts > 3 && length > 3,
  );
}

function shortenSectionContent(sectionContent) {
  const longContent = sectionContent
    // Обійтися без копірайтингу
    .replaceAll('（见释义）', '')
    // зменшити символи
    .replaceAll('——', '—')
    // на всю ширину напівшир
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replaceAll('：', ':')
    .replaceAll('；', ';')
    .replaceAll('、', '|')
    .replaceAll('，', ',')
    .replaceAll('。', '.')
    .replaceAll('“', `'`)
    .replaceAll('”', `'`)
    // видалити безглузді пробіли
    .replaceAll('. ', '.')
    .replaceAll(` '`, `'`)
    .replaceAll('; ', ';');
  const words = nodejieba.cut(longContent);
  return shortenByDictionary(
    longContent,
    words,
    (counts, length) => counts > 4 && length > 1,
  );
}

function shortenContent(longContent) {
  if (longContent.split(' ').length > 100) {
    return shortenTableContent(longContent);
  }
  return shortenSectionContent(longContent);
}

module.exports = {
  isDiseaseIntro,
  shortenDiseaseIntro,
  shortenContent,
  shortenTableContent,
  shortenSectionContent,
};
