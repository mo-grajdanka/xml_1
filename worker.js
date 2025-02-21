
// Подключаем SAX-парсер (через jsDelivr CDN)
importScripts('https://cdn.jsdelivr.net/npm/sax@1.4.1/lib/sax.js');

self.onmessage = function(e) {
  const file = e.data.file;
  if (!file) {
    postMessage({ type: 'progress', message: 'Файл не передан.' });
    return;
  }

  // Размер порции (1 МБ)
  const chunkSize = 1024 * 1024;
  let offset = 0;

  // Итоговый массив, где каждая запись соответствует одному <land_record>
  const records = [];

  // Храним данные текущего <cadastral_block>
  let currentBlockData = null;

  // Текущая "запись" (когда встречаем <land_record>)
  let currentRecord = null;

  // Стек имен открытых тегов (SAX)
  let currentStack = [];

  // Инициализируем SAX-парсер
  const parser = sax.parser(true);

  // Вызывается при открытии тега
  parser.onopentag = (node) => {
    currentStack.push(node.name);

    if (node.name === 'cadastral_block') {
      // Начинаем накапливать данные об этом блоке
      currentBlockData = {};
    }

    if (node.name === 'land_record') {
      // Начинаем новую запись, копируя уже собранные данные родительского блока
      currentRecord = { ...currentBlockData };
    }

    //  парсить атрибуты, можно добавить логику здесь
    // Пример:
    if (currentRecord && Object.keys(node.attributes).length > 0) {
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        currentRecord[`attr_${attrName}`] = attrValue;
      }
    }
  };

  // Вызывается при встрече текстового узла (между <tag>...</tag>)
  parser.ontext = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Текущий «последний» открытый тег
    const lastTag = currentStack[currentStack.length - 1];

    // Если мы внутри <cadastral_block> и при этом НЕ дошли до <land_record>,
    // то кладём текст в currentBlockData.
    if (currentBlockData && !currentRecord) {
      currentBlockData[lastTag] = (currentBlockData[lastTag] || '') + trimmed;
    }

    // Если мы находимся внутри <land_record>, то дополняем currentRecord.
    if (currentRecord) {
      currentRecord[lastTag] = (currentRecord[lastTag] || '') + trimmed;
    }
  };

  // Вызывается при закрытии тега
  parser.onclosetag = (tagName) => {
    if (tagName === 'land_record' && currentRecord) {
      // Закончили один <land_record> — добавляем в общий массив
      records.push(currentRecord);
      currentRecord = null;
    }

    if (tagName === 'cadastral_block') {
      // Закрыли текущий блок — очищаем данные
      currentBlockData = null;
    }

    // Убираем закрытый тег из стека
    currentStack.pop();
  };

  // Если парсер встречает ошибку
  parser.onerror = (error) => {
    postMessage({ type: 'progress', message: 'Ошибка парсинга: ' + error.message });
    parser.error = null;
    parser.resume();
  };

  // Постраничное чтение файла 
  function readNextChunk() {
    const slice = file.slice(offset, offset + chunkSize);
    const reader = new FileReader();

    reader.onload = (event) => {
      const chunk = event.target.result;
      try {
        parser.write(chunk);
      } catch (e) {
        postMessage({ type: 'progress', message: 'Ошибка во время парсинга: ' + e.message });
      }

      offset += chunkSize;
      postMessage({ type: 'progress', message: `Обработано ${Math.min(offset, file.size)} из ${file.size} байт` });

      if (offset < file.size) {
        // Продолжаем читать, пока не закончится файл
        readNextChunk();
      } else {
        // Завершаем парсер
        try {
          parser.end();
        } catch (e) {
          postMessage({ type: 'progress', message: 'Ошибка завершения парсера: ' + e.message });
        }
        // Отправляем результат в главный поток (index.html)
        postMessage({ type: 'result', records });
      }
    };

    reader.onerror = () => {
      postMessage({ type: 'progress', message: 'Ошибка чтения файла.' });
    };

    reader.readAsText(slice);
  }

  // Запускаем чтение первой порции
  readNextChunk();
};
