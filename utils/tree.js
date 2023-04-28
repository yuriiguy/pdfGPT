const { getSummaryWithCache } = require('./ai');
const { writeKnowledge, writeContentTree } = require('./fs');
const { shortenContent } = require('./content');
const { encode } = require('gpt-3-encoder');
function getParentNo(titleNo) {
  const parentNo = titleNo.split('.').slice(0, -1).join('.');
  return parentNo;
}
// побудувати вкладене дерево
function toNestTree(flattenTree) {
  const tree = [];
  // побудувати вузол map
  const nodesMap = flattenTree.reduce((acc, cur) => {
    acc[cur.titleNo] = cur;
    return acc;
  }, {});

  function updateParentTokenLength(node, tokenLength) {
    const parentNo = getParentNo(node.titleNo);
    if (parentNo && nodesMap[parentNo]) {
      const parentNode = nodesMap[parentNo];
      // Збільште довжину вмісту батьківського вузла
      parentNode.allTokenLength =
        (parentNode.allTokenLength || 0) + tokenLength;
      // рекурсивне накопичення
      updateParentTokenLength(parentNode, tokenLength);
    }
  }

  // Побудуйте вкладене дерево вузлів і обчисліть загальну довжину рядка вмісту, охопленого кожним вузлом
  flattenTree.forEach(node => {
    // Оновіть довжину маркера відповідного вузла
    const { tokenLength, summaryTokenLength } = node;
    const currentTokenLength = summaryTokenLength || tokenLength;
    // Ініціалізуйте власну довжину вмісту вмістом власного вузла
    // Спочатку він міг бути ініціалізований власними дочірніми вузлами, тому він накопичується
    node.allTokenLength = (node.allTokenLength || 0) + currentTokenLength;
    updateParentTokenLength(node, currentTokenLength);
    const parentNo = getParentNo(node.titleNo);
    // Вставте вузол у батьківський вузол
    if (parentNo && nodesMap[parentNo]) {
      const parentNode = nodesMap[parentNo];
      parentNode.children.push(node);
    } else {
      tree.push(node);
    }
  });
  return tree;
}

// Якщо кількість токенів текстового вузла перевищує 1000, їх буде реконструйовано у підсумковий опис
async function rebuildTreeWithAISummary(docTree, pdfName) {
  for (let index = 0; index < docTree.length; index++) {
    const node = docTree[index];
    if (node.tokenLength > 1000 && !node.summary) {
      // Він дуже довгий, стисніть його ще раз
      // const { content, tokenLength } =
      //   node.tokenLength < 3600
      //     ? node
      //     : {
      //         content: shortenContent(node.content),
      //       };
      const { content, tokenLength } = node;
      node.summary = await getSummaryWithCache(
        { content, tokenLength },
        pdfName,
      );
      console.log('build summary success', node.titleNo);
    }
    if (node.summary && !node.summaryTokenLength) {
      node.summaryTokenLength = encode(node.summary).length;
    }
  }
  return docTree;
}

// Створіть вкладене дерево вмісту та оптимізуйте зведення надто довгих дочірніх вузлів, щоб зменшити вміст вузла
async function buildNestTreeWithAISummary(docTree, pdfName) {
  const tree = await rebuildTreeWithAISummary(docTree, pdfName);
  const nestTree = toNestTree(tree);
  // записати в файл
  writeContentTree(pdfName, nestTree);
  return nestTree;
}

// Об’єднання кількох абзаців в один
function unionContent(node) {
  let content = `第${node.titleNo}节内容:` + (node.summary || node.content);
  node.children.forEach(child => {
    content = content + '|' + unionContent(child);
  });
  return content;
}

// Рекурсивно будуйте вкладені дерева в абзаци зведеного вмісту
function buildContents(nodes, contents) {
  const newContents = contents || [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.allTokenLength > 3000) {
      buildContents(node.children, newContents);
    } else {
      const content = unionContent(node);
      newContents.push(content);
    }
  }
  return newContents;
}

// створити базу знань
async function buildKnowledgeFromDocTree(docTree, pdfName) {
  const nestTree = await buildNestTreeWithAISummary(docTree, pdfName);
  // const fs = require('fs');
  // fs.writeFileSync('./tempNestTree.json', JSON.stringify(nestTree));
  const knowledge = buildContents(nestTree);
  // 写入文件
  writeKnowledge(pdfName, knowledge);
  return knowledge;
}
module.exports = { buildKnowledgeFromDocTree };
