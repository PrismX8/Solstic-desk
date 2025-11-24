const native = require('../native');

const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x01000;

const KEYEVENTF_KEYUP = 0x0002;

const BUTTON_FLAGS = {
  left: { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP },
  right: { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP },
  middle: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
};

const KEY_MAP = new Map([
  ['escape', 0x1b],
  ['enter', 0x0d],
  ['tab', 0x09],
  ['backspace', 0x08],
  ['delete', 0x2e],
  ['shift', 0x10],
  ['control', 0x11],
  ['alt', 0x12],
  ['meta', 0x5b],
  ['space', 0x20],
  ['arrowup', 0x26],
  ['arrowdown', 0x28],
  ['arrowleft', 0x25],
  ['arrowright', 0x27],
  ['pageup', 0x21],
  ['pagedown', 0x22],
  ['home', 0x24],
  ['end', 0x23],
  ['insert', 0x2d],
]);

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
for (const letter of LETTERS) {
  KEY_MAP.set(letter, letter.toUpperCase().charCodeAt(0));
}
const DIGITS = '0123456789';
for (const digit of DIGITS) {
  KEY_MAP.set(digit, digit.charCodeAt(0));
}

function toVk(key) {
  if (!key) return undefined;
  const normalized = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  return KEY_MAP.get(normalized);
}

function handleMouse(event, screenSize) {
  switch (event.kind) {
    case 'mouse_move': {
      const x = Math.round(event.x * screenSize.width);
      const y = Math.round(event.y * screenSize.height);
      native.setCursorPos(x, y);
      break;
    }
    case 'mouse_down': {
      const button = BUTTON_FLAGS[event.button || 'left'];
      if (button) native.mouseEvent(button.down, 0, 0, 0);
      break;
    }
    case 'mouse_up': {
      const button = BUTTON_FLAGS[event.button || 'left'];
      if (button) native.mouseEvent(button.up, 0, 0, 0);
      break;
    }
    case 'mouse_wheel': {
      const deltaY = Math.round(event.deltaY || 0);
      const deltaX = Math.round(event.deltaX || 0);
      if (deltaY) {
        native.mouseEvent(MOUSEEVENTF_WHEEL, 0, 0, Math.sign(deltaY) * 120);
      }
      if (deltaX) {
        native.mouseEvent(MOUSEEVENTF_HWHEEL, 0, 0, Math.sign(deltaX) * 120);
      }
      break;
    }
    default:
      break;
  }
}

function sendKey(vk, type = 'down') {
  native.keybdEvent(vk, type === 'up' ? KEYEVENTF_KEYUP : 0);
}

function handleKeyboard(event) {
  if (event.kind === 'text' && event.text) {
    for (const char of event.text) {
      const vk = toVk(char);
      if (!vk) continue;
      sendKey(vk, 'down');
      sendKey(vk, 'up');
    }
    return;
  }
  const vk = toVk(event.key);
  if (!vk) return;

  const modifiers = [];
  if (event.meta?.ctrl || event.meta?.control) modifiers.push(KEY_MAP.get('control'));
  if (event.meta?.alt) modifiers.push(KEY_MAP.get('alt'));
  if (event.meta?.shift) modifiers.push(KEY_MAP.get('shift'));
  if (event.meta?.meta) modifiers.push(KEY_MAP.get('meta'));

  if (event.kind === 'key_down') {
    modifiers.forEach((code) => code && sendKey(code, 'down'));
    sendKey(vk, 'down');
  } else if (event.kind === 'key_up') {
    sendKey(vk, 'up');
    modifiers.reverse().forEach((code) => code && sendKey(code, 'up'));
  }
}

function applyInputEvent(event, screenSize) {
  if (event.kind.startsWith('mouse')) {
    handleMouse(event, screenSize);
  } else {
    handleKeyboard(event);
  }
}

module.exports = { applyInputEvent };

