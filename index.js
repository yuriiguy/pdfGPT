const { getPdfName } = require('./utils/fs');
const { buildDocTreeFromPdf } = require('./utils/pdf');
const { buildKnowledgeFromDocTree } = require('./utils/tree');
const { buildKnowledgeEmbeddings } = require('./utils/embedding');
const ask = require('./utils/ask');

async function loadingPdf(pdfPath) {
  const pdfName = getPdfName(pdfPath);
  // побудувати дерево вмісту
  const docTree = await buildDocTreeFromPdf(pdfPath);
  // const fs = require('fs');
  // fs.writeFileSync('./temp.json', JSON.stringify(docTree))
  // створити базу знань
  const knowledge = await buildKnowledgeFromDocTree(docTree, pdfName);
  // // Створіть вектори бази знань
  await buildKnowledgeEmbeddings(knowledge, pdfName);
}

async function askQuestion(question, pdfName) {
  console.log(`AI Намагаюся відповісти на ваше запитання『${question}』，будь ласка, зачекайте...\n`);
  const answer = await ask(question, pdfName);
  console.log(`твоє запитання『${question}"Дайте відповідь на наступне：\n==========\n${answer}\n==========\n`);
  return answer;
}
module.exports = {
  loadingPdf,
  askQuestion,
};
