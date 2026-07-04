// src/components/Viewer/SrNameDialog.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SrNameDialogProps {
  open: boolean;
  defaultName?: string;
  isSaving?: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}

export default function SrNameDialog({ open, defaultName = '', isSaving = false, onCancel, onSave }: SrNameDialogProps) {
  const [value, setValue] = useState(defaultName);

  useEffect(() => {
    if (open) setValue(defaultName ?? '');
  }, [open, defaultName]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đặt tên cho SR</DialogTitle>
          <DialogDescription>
            Vui lòng nhập tên cho Structured Report (tên này sẽ hiển thị thay cho "Group X").
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="VD: Lung - measurement report"
            aria-label="Tên SR"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (value.trim()) onSave(value.trim());
              }
            }}
          />
        </div>

        <DialogFooter className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>Hủy</Button>
          <Button onClick={() => onSave(value.trim())} disabled={isSaving || !value.trim()}>
            {isSaving ? 'Đang tạo...' : 'Tạo SR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
