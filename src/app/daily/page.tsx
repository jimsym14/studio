import { DailyGame } from '@/components/daily/daily-game';
import { AuthGate } from '@/components/auth-gate';

export default function DailyPage() {
    return (
        <AuthGate>
            <DailyGame />
        </AuthGate>
    );
}
