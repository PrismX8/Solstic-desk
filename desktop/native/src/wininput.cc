#include <napi.h>
#include <Windows.h>

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
  mouse_event(flag, dx, dy, data, 0);
  return env.Undefined();
}

Napi::Value KeybdEventWrapped(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected vk and flags").ThrowAsJavaScriptException();
    return env.Null();
  }
  BYTE vk = static_cast<BYTE>(info[0].As<Napi::Number>().Uint32Value());
  DWORD flags = info[1].As<Napi::Number>().Uint32Value();
  keybd_event(vk, 0, flags, 0);
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setCursorPos", Napi::Function::New(env, SetCursorPosWrapped));
  exports.Set("mouseEvent", Napi::Function::New(env, MouseEventWrapped));
  exports.Set("keybdEvent", Napi::Function::New(env, KeybdEventWrapped));
  return exports;
}

NODE_API_MODULE(wininput, Init)

