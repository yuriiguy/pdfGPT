const pdfjs = require('pdfjs-dist');
const { encode } = require('gpt-3-encoder');
const {
  isDiseaseIntro,
  shortenDiseaseIntro,
  shortenContent,
} = require('./content');
// обкладинка
const PAGE_TYPE_COVER = 0;
// Зміст
const PAGE_TYPE_CATALOG = 1;
// текст
const PAGE_TYPE_MAIN = 2;
const TITLE_SPLIT = '__TITLE__';
const QUOTE_SPLIT = '__QUOTE__';
const REF_SPLIT = '__REF__';
function buildDocTree(longStr) {
  const [, ...sections] = longStr.split(TITLE_SPLIT); // розділіть рядок на section масиви
  const treeNodes = sections
    .map(section => {
      let [titleNo, ...content] = section.split(' ');
      if (titleNo.endsWith('.')) {
        titleNo = titleNo.slice(0, -1);
      }
      const matchedTitleNo = titleNo.match(/^\d+(\.\d*)*\.?/)?.[0];
      let joinedContent = content.join(' ');
      // Поясніть, що в заголовку є вміст, який не є чисто цифровим заголовком, і поєднайте цю частину вмісту в текст
      if (matchedTitleNo !== titleNo) {
        const titleContent = titleNo.replace(/^\d+(\.\d*)*\.?/, '');
        joinedContent = titleContent + ' ' + joinedContent;
      }
      let tokenLength = encode(joinedContent).length;
      // Зміст введення хвороби дуже довгий, і детальну інформацію про конкретну хворобу можна каструвати
      if (isDiseaseIntro(tokenLength, joinedContent)) {
        joinedContent = shortenDiseaseIntro(joinedContent);
      } else if (tokenLength > 4000) {
        // Справа не в тому, що введення хвороби також дуже довге, і воно стискається за допомогою методу стиснення словника
        joinedContent = shortenContent(joinedContent);
      }
      tokenLength = encode(joinedContent).length;
      return {
        titleNo: matchedTitleNo || titleNo,
        content: joinedContent,
        children: [],
        refs: [],
        tokenLength,
      };
    })
    // .map(node => {
    //   const { content } = node;
    //   if (content.indexOf(QUOTE_SPLIT)) {
    //     const regex = /__QUOTE__([0-9.]+)/g;
    //     let match;
    //     while ((match = regex.exec(content)) !== null) {
    //       node.refs.push(match[1]);
    //     }
    //     node.content = node.content
    //       .replace(regex, '')
    //       .replace(/第\s*\d+\s*页\s*共\d+页/g, '');
    //     return node;
    //   }
    // });
  return treeNodes;
}

function isCatalogPage({ items }) {
  const pageContent = items.map(i => i.str).join('');
  if (pageContent.indexOf('Каталог термінів') > -1) {
    return true;
  }
  if (pageContent.split(/(?=\d+.\d+)/).length > 10) {
    return true;
  }
}

// Вставте вміст анотації в основний текст
function moveNoteToMain(items) {
  const { mainFontHeight, titlePositionX, pageNumberPositionY } =
    getPageMetaData(items);
  const isRefTitle = item =>
    Math.abs(item.transform[4] - titlePositionX) < 2 &&
    item.height / mainFontHeight < 0.7;
  const refSplitIndex = items.findIndex(isRefTitle);
  if (refSplitIndex < 0) {
    return items;
  }
  // текст
  const mainItems = items.slice(0, refSplitIndex);
  // Примітка
  items
    .slice(refSplitIndex)
    .map(refItem => {
      if (isRefTitle(refItem)) {
        refItem.str = `${REF_SPLIT}${refItem.str.trim()} `;
      }
      return refItem.str;
    })
    .join('')
    .split(REF_SPLIT)
    .forEach(refContent => {
      const [refNo, ...content] = refContent.split(' ');
      if (refNo && content.length) {
        const mainItem = mainItems.find(i => i.str.trim() === refNo);
        if (!mainItem) {
          return;
        }
        mainItem.str = `[${content.join('')}]`;
      }
    });
  return mainItems;
}

async function getPdfItems(pdfPath) {
  const pdfItems = [];
  let pageType = PAGE_TYPE_CATALOG;
  await pdfjs.getDocument(pdfPath).promise.then(doc => {
    const numPages = doc.numPages;
    let lastPromise = doc.getMetadata();
    const loadPage = function (pageNum) {
      return doc.getPage(pageNum).then(page => {
        return page
          .getTextContent({
            disableCombineTextItems: true,
            // includeMarkedContent: true,
          })
          .then(pageData => {
            // Якщо раніше це була обкладинка, поточна сторінка вже є сторінкою каталогу, а статус змінено на сторінку каталогу
            if (pageType === PAGE_TYPE_COVER && isCatalogPage(pageData)) {
              pageType = PAGE_TYPE_CATALOG;
            }
            // Якщо раніше це була сторінка каталогу, поточна сторінка більше не є сторінкою каталогу, а статус змінюється на текстову сторінку
            if (pageType === PAGE_TYPE_CATALOG && !isCatalogPage(pageData)) {
              pageType = PAGE_TYPE_MAIN;
            }
            // Почніть із основної частини, натисніть вміст
            if (pageType === PAGE_TYPE_MAIN) {
              const contentItems = pageData.items.map(i => ({ ...i, pageNum }));
              pdfItems.push(...moveNoteToMain(contentItems));
            }
            page.cleanup();
          });
      });
    };
    // Завантаження першої сторінки очікуватиме на метаданих, а наступні завантаження – на попередніх сторінках.
    for (let i = 1; i <= numPages; i++) {
      lastPromise = lastPromise.then(() => loadPage(i));
    }
    return lastPromise;
  });
  return pdfItems;
}
const isTitleNo = (items, itemIndex) => {
  const item = items[itemIndex];
  const nextItem = items[itemIndex + 1];
  const { str: itemContent } = item;
  // Взагалі кажучи, надто довгі символи точно не є заголовками, що зменшує витрати на подальшу регулярну перевірку
  if (itemContent.length > 20) {
    return false;
  }
  if (nextItem && nextItem.str.trim() === '页') {
    return item;
  }
  return /^\d+(\.\d*)*\.?/.test(itemContent.trim());
  // return /^\d+(\.\d*)*\.?$/.test(itemContent.trim());
};

function getPageMetaData(items) {
  const fontHeightCountMap = {};
  const numberPositionXCountMap = {};
  let minPositionY = Infinity;
  items.forEach((cur, index) => {
    const { height, transform } = cur;
    const positionX = transform[4];
    const positionY = transform[5];
    if (!height || !transform) {
      console.log(cur);
    }
    const isTitle = isTitleNo(items, index);
    fontHeightCountMap[height] = (fontHeightCountMap[height] || 0) + 1;
    minPositionY = Math.min(minPositionY, positionY);
    if (isTitle) {
      numberPositionXCountMap[positionX] =
        (numberPositionXCountMap[positionX] || 0) + 1;
    }
  }, {});
  const sortedHeights = Object.keys(fontHeightCountMap)
    .map(height => {
      return {
        height: Number(height),
        counts: fontHeightCountMap[height],
      };
    })
    .sort((a, b) => b.counts - a.counts);
  const sortedPositionXs = Object.keys(numberPositionXCountMap)
    .map(positionX => {
      return {
        positionX: Number(positionX),
        counts: numberPositionXCountMap[positionX],
      };
    })
    .filter(i => i.positionX < 100)
    .sort((a, b) => b.counts - a.counts);
  // у крайньому лівому куті, інакше він буде забруднений кількістю деяких елементів списку
  return {
    // Найбільш використовуваним розміром шрифту, і це розумно вважати, є розмір основного шрифту
    mainFontHeight: sortedHeights[0].height,
    // Це число, і воно безперервно відображається в координаті х.Є підстави вважати, що це номер назви
    titlePositionX: sortedPositionXs?.[0]?.positionX,
    // Нижня частина, в ідеалі, це розташування номера сторінки. Але він має бути меншим за 60, інакше це PDF без номерів сторінок
    pageNumberPositionY: minPositionY < 60 ? minPositionY : undefined,
  };
}

function rebuildPdfItems(items) {
  const { titlePositionX, pageNumberPositionY, mainFontHeight } =
    getPageMetaData(items);
  return items
    .map((item, index) => {
      const { height: currentHeight, str: itemContent, transform } = item;
      const nextItem = items[index + 1];
      const prevItem = items[index - 1];
      const positionX = transform[4];
      const positionY = transform[5];
      // Дані про номер сторінки не потрібні
      if (pageNumberPositionY === positionY) {
        return null;
      }
      if (itemContent.startsWith('графік')) {
        item.str = `${TITLE_SPLIT}${itemContent.trim()}`;
        return item;
      }
      if (!isTitleNo(items, index)) {
        return item;
      }
      // Великий заголовок, допустіть помилку
      if (Math.abs(positionX - titlePositionX) < 2) {
        item.str = `${TITLE_SPLIT}${itemContent.trim()}`;
        return item;
      }
      // const prevHeight = prevItem?.height;
      // const nextHeight = nextItem.height;
      // цитати примітки
      // if (
      //   prevItem &&
      //   currentHeight < prevHeight &&
      //   currentHeight < nextHeight
      // ) {
      //   item.str = `${QUOTE_SPLIT}${itemContent}`;
      //   return item;
      // }
      return item;
    })
    .filter(Boolean);
}

async function buildDocTreeFromPdf(pdfPath) {
  const items = await getPdfItems(pdfPath);
  const itemsWithTreeInfo = rebuildPdfItems(items);
  // const fs = require('fs');
  // console.log('===');
  // fs.writeFileSync('./tempItems.json', JSON.stringify(itemsWithTreeInfo));
  return buildDocTree(itemsWithTreeInfo.map(i => i.str).join(''));
}
module.exports = {
  buildDocTreeFromPdf,
  getPdfItems,
  rebuildPdfItems,
};
