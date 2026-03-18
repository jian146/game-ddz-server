// 洗牌
const shuffle4 = (arr: number[]) => {
  let len = arr.length;
  let random: number;
  while (len != 0) {
    // 無符号右移位运算符向下取整（注意这里必须加分号，否则报错）
    random = (Math.random() * len--) >>> 0;
    // ES6结构赋值实现变量互换
    [arr[len], arr[random]] = [arr[random], arr[len]];
  }
  return arr;
};

export const shuffleCard = (cardlist: number[]) => {
  return shuffle4(cardlist);
};

// 摸牌
export const getCard = (count: number, cardList: number[]) => {
  return cardList.splice(0, count);
};

/**
 * 获取 x 和 y 之间随机数（ra >= x && ra <= y）
 */
export const getRoundNumber = (x: number, y: number) => {
  return Math.round(Math.random() * (y - x) + x);
};

