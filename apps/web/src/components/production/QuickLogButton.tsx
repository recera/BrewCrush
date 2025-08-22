'use client';

import { useState } from 'react';
import { Button } from '@brewcrush/ui';
import { Plus, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuickLog } from './QuickLog';

interface QuickLogButtonProps {
  batchId: string;
  batchNumber: string;
  tankName?: string;
  currentSG?: number;
  currentTemp?: number;
  currentPH?: number;
  lastReading?: {
    sg?: number;
    temp?: number;
    ph?: number;
    reading_at: string;
  };
  className?: string;
  variant?: 'fab' | 'button';
  onSave?: () => void;
}

export function QuickLogButton({
  batchId,
  batchNumber,
  tankName,
  currentSG,
  currentTemp,
  currentPH,
  lastReading,
  className,
  variant = 'fab',
  onSave,
}: QuickLogButtonProps) {
  const [showQuickLog, setShowQuickLog] = useState(false);

  if (variant === 'fab') {
    return (
      <>
        <Button
          size="lg"
          className={cn(
            "fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50",
            "bg-primary hover:bg-primary/90",
            className
          )}
          onClick={() => setShowQuickLog(true)}
          aria-label="Quick log fermentation reading"
        >
          <Plus className="h-6 w-6" />
        </Button>

        {showQuickLog && (
          <QuickLog
            batchId={batchId}
            batchNumber={batchNumber}
            tankName={tankName}
            currentSG={currentSG}
            currentTemp={currentTemp}
            currentPH={currentPH}
            lastReading={lastReading}
            onClose={() => setShowQuickLog(false)}
            onSave={() => {
              setShowQuickLog(false);
              onSave?.();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className={cn("gap-2", className)}
        onClick={() => setShowQuickLog(true)}
      >
        <FlaskConical className="h-4 w-4" />
        Quick Log
      </Button>

      {showQuickLog && (
        <QuickLog
          batchId={batchId}
          batchNumber={batchNumber}
          tankName={tankName}
          currentSG={currentSG}
          currentTemp={currentTemp}
          currentPH={currentPH}
          lastReading={lastReading}
          onClose={() => setShowQuickLog(false)}
          onSave={() => {
            setShowQuickLog(false);
            onSave?.();
          }}
        />
      )}
    </>
  );
}