'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export interface EditLabelDialogProps {
  currentLabel: string;
  onCancel: () => void;
  onSave: (newLabel: string) => void;
}

export default function EditLabelDialog({
  currentLabel,
  onCancel,
  onSave,
}: EditLabelDialogProps) {
  const [newLabel, setNewLabel] = useState(currentLabel);

  // keep state in sync if currentLabel changes
  useEffect(() => setNewLabel(currentLabel), [currentLabel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-sm">
      <div className="bg-card p-6 rounded-lg shadow-lg w-[300px]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Edit Measurement Label</h2>
          <Button
            variant="ghost"
            size="icon"
            className="text-secondary-foreground hover:text-foreground text-xl"
            onClick={onCancel}
            aria-label="Close"
          >
            <i className="fas fa-times" />
          </Button>
        </div>
        <input
          type="text"
          className="w-full p-2 rounded border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Enter new label"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(newLabel)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
