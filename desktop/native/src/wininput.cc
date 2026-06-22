#include <napi.h>
#include <Windows.h>

Napi::Value HideConsoleWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Hide the console window if one exists
  HWND consoleWindow = GetConsoleWindow();
  if (consoleWindow != NULL) {
    ShowWindow(consoleWindow, SW_HIDE);
  }

  // Detach from the console subsystem entirely
  FreeConsole();

  return Napi::Boolean::New(env, true);
}

Napi::Value HideWindowFromTaskbarWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected a Buffer containing HWND")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  HWND hwnd = *reinterpret_cast<HWND*>(buf.Data());

  if (hwnd == NULL || !IsWindow(hwnd)) {
    return Napi::Boolean::New(env, false);
  }

  // Add WS_EX_TOOLWINDOW to hide from Alt+Tab and taskbar.
  // Do NOT call ShowWindow(SW_HIDE) here — JS controls when to hide
  // (e.g. when a viewer connects) via win.hide().
  LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
  exStyle |= WS_EX_TOOLWINDOW;
  exStyle |= WS_EX_NOACTIVATE;
  SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);

  return Napi::Boolean::New(env, true);
}

Napi::Value SetCursorPosWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected x and y").ThrowAsJavaScriptException();
    return env.Null();
  }
  int x = info[0].As<Napi::Number>().Int32Value();
  int y = info[1].As<Napi::Number>().Int32Value();
  BOOL result = SetCursorPos(x, y);
  return Napi::Boolean::New(env, result == TRUE);
}

Napi::Value MouseEventWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) {
    Napi::TypeError::New(env, "Expected flag, dx, dy, data").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD flag = info[0].As<Napi::Number>().Uint32Value();
  int dx = info[1].As<Napi::Number>().Int32Value();
  int dy = info[2].As<Napi::Number>().Int32Value();
  DWORD data = info[3].As<Napi::Number>().Uint32Value();
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dx = dx;
  input.mi.dy = dy;
  input.mi.mouseData = data;
  input.mi.dwFlags = flag;
  UINT sent = SendInput(1, &input, sizeof(INPUT));
  return Napi::Boolean::New(env, sent == 1);
}

Napi::Value KeybdEventWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected vk and flags").ThrowAsJavaScriptException();
    return env.Null();
  }
  BYTE vk = static_cast<BYTE>(info[0].As<Napi::Number>().Uint32Value());
  DWORD flags = info[1].As<Napi::Number>().Uint32Value();
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = vk;
  input.ki.dwFlags = flags;
  UINT sent = SendInput(1, &input, sizeof(INPUT));
  return Napi::Boolean::New(env, sent == 1);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setCursorPos", Napi::Function::New(env, SetCursorPosWrapped));
  exports.Set("mouseEvent", Napi::Function::New(env, MouseEventWrapped));
  exports.Set("keybdEvent", Napi::Function::New(env, KeybdEventWrapped));
  exports.Set("hideConsole", Napi::Function::New(env, HideConsoleWrapped));
  exports.Set("hideWindowFromTaskbar", Napi::Function::New(env, HideWindowFromTaskbarWrapped));
  return exports;
}

NODE_API_MODULE(wininput, Init)

