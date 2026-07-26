import React from "react";
import { LogOut } from "lucide-react";

export function LogoutModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
      <div className="w-full max-w-xs animate-in fade-in zoom-in duration-200 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <LogOut className="size-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">ยืนยันการออกจากระบบ</h3>
        <p className="mt-1 text-sm text-slate-500">คุณต้องการดำเนินการต่อหรือไม่?</p>
        
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}