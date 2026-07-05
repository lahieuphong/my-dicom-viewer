import type { FormEvent } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type PatientLookupFormProps = {
  input: string;
  error: string;
  isPending: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function PatientLookupForm({
  input,
  error,
  isPending,
  onInputChange,
  onSubmit,
}: PatientLookupFormProps) {
  return (
    <Card className="w-full max-w-sm md:max-w-lg p-4 md:p-6 rounded-2xl shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <i className="fas fa-search w-4 h-4 md:w-5 md:h-5 text-muted-foreground" />
          <CardTitle className="text-xl md:text-2xl font-semibold text-foreground dark:text-white">
            Thông tin tra cứu
          </CardTitle>
        </div>
        <Separator className="my-2" />
        <CardDescription className="text-xs md:text-sm text-muted-foreground">
          Nhập mã tra cứu được cung cấp khi bạn khám bệnh
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label
              htmlFor="lookup"
              className="flex items-center gap-2 text-sm md:text-base font-medium text-foreground dark:text-white"
            >
              <i className="fas fa-id-card-alt text-sm md:text-base text-muted-foreground" />
              Tra cứu mã bệnh nhân
            </Label>
            <Input
              id="lookup"
              placeholder="Nhập mã tra cứu..."
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              className="w-full h-10 md:h-12 px-3 md:px-4 border-2 border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-400"
              disabled={isPending}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full h-10 md:h-12 text-sm md:text-base font-medium bg-gradient-to-r from-blue-400 to-blue-600 hover:from-muted hover:to-muted hover:text-foreground text-white rounded-md"
            disabled={isPending}
          >
            Tra cứu Bệnh án
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
