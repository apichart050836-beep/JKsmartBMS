import React, { useState } from "react";
import { ref, get } from "firebase/database";
import { rtdb } from "../lib/firebase";
import { Zap, Lock, User, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";

export function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            // 1. ดึงข้อมูล User ทั้งหมดจาก path 'userConf'
            const dbRef = ref(rtdb, "userConf");
            const snapshot = await get(dbRef);

            if (snapshot.exists()) {
                const allUsers = snapshot.val();

                // 2. ค้นหา User ที่ตรงกับ username ที่กรอกเข้ามา
                // เราจะเปลี่ยน Object เป็น Array เพื่อใช้ .find() ค้นหา
                const foundUserKey = Object.keys(allUsers).find(key =>
                    allUsers[key].username && allUsers[key].username.trim() === username.trim()
                );

                if (foundUserKey) {
                    const userData = allUsers[foundUserKey];

                    // 3. ตรวจสอบรหัสผ่าน (แปลงเป็น String เพื่อความปลอดภัย)
                    if (userData.password.toString() === password.toString()) {

                        // Login สำเร็จ
                        localStorage.setItem("isLoggedIn", "true");
                        localStorage.setItem("currentUser", userData.username); // เก็บ username ไว้

                        // 4. ตรวจสอบสถานะ forceChangePassword
                        if (userData.forceChangePassword === true) {
                            localStorage.setItem("mustChangePassword", "true");
                        } else {
                            localStorage.removeItem("mustChangePassword");
                        }

                        // ส่งต่อหน้าถัดไป
                        onLoginSuccess();

                    } else {
                        setError("รหัสผ่านไม่ถูกต้อง");
                    }
                } else {
                    setError("ไม่พบชื่อผู้ใช้นี้ในระบบ");
                }
            } else {
                setError("ไม่พบข้อมูลผู้ใช้ในระบบ");
            }
        } catch (err) {
            console.error(err);
            setError("เกิดข้อผิดพลาดในการเชื่อมต่อ: " + err.message);
        } finally {
            setLoading(false);
        }
    };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4">
      {/* Engineering Grid Background */}
      <div className="absolute inset-0 z-0">
        <div className="h-full w-full bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      {/* Glow Effects */}
      <div className="absolute top-20 left-10 size-72 rounded-full bg-emerald-200/30 blur-[100px]" />
      <div className="absolute bottom-20 right-10 size-72 rounded-full bg-blue-200/30 blur-[100px]" />

      {/* Login Form */}
      <form 
        onSubmit={handleLogin} 
        className="relative z-10 w-full max-w-[400px] rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.05)] backdrop-blur-xl transition-all"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-300">
            <Zap className="size-7" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">System Login</h2>
          <p className="mt-1 text-sm text-slate-500">BMS Management Portal</p>
        </div>

        <div className="space-y-4">
          <div className="group relative">
            <User className="absolute left-4 top-3.5 size-4 text-slate-400 group-focus-within:text-emerald-600 transition-colors" />
            <input
              type="text"
              placeholder="Username"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 py-3.5 pl-11 pr-4 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="group relative">
            <Lock className="absolute left-4 top-3.5 size-4 text-slate-400 group-focus-within:text-emerald-600 transition-colors" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 py-3.5 pl-11 pr-12 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button 
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 font-semibold text-white shadow-lg shadow-slate-300 transition-all hover:bg-slate-800 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            "Access System"
          )}
        </button>
      </form>
    </div>
  );
}