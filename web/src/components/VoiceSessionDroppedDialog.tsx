import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { useVoice } from '@/lib/voice-context'
import { useSessions } from '@/hooks/queries/useSessions'
import { useAppContext } from '@/lib/app-context'
import { getReceivingSessionId, resolveVoiceFocusLabel } from '@/lib/voice-focus'

export function VoiceSessionDroppedDialog() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { api } = useAppContext()
    const voice = useVoice()
    const { sessions } = useSessions(api)
    const [pendingAction, setPendingAction] = useState<'end' | 'new' | null>(null)

    const sessionId = getReceivingSessionId(voice.voiceFocus)
    const sessionLabel = resolveVoiceFocusLabel(voice.voiceFocus, sessions, sessionId)

    const isOpen = voice.receivingSessionDropped && Boolean(sessionId)

    const handleEndVoice = async () => {
        setPendingAction('end')
        try {
            await voice.stopVoice()
        } finally {
            setPendingAction(null)
        }
    }

    const handleNewSession = async () => {
        setPendingAction('new')
        try {
            await voice.stopVoice()
            void navigate({ to: '/sessions/new' })
        } finally {
            setPendingAction(null)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={() => { /* operator must pick an action */ }}>
            <DialogContent data-testid="voice-session-dropped-dialog">
                <DialogHeader>
                    <DialogTitle>{t('voice.dropped.title')}</DialogTitle>
                    <DialogDescription>
                        {t('voice.dropped.description', { session: sessionLabel ?? sessionId ?? '' })}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={pendingAction !== null}
                        onClick={() => {
                            void handleNewSession()
                        }}
                    >
                        {pendingAction === 'new' ? t('voice.dropped.spawning') : t('voice.dropped.spawnFresh')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={pendingAction !== null}
                        onClick={() => {
                            void handleEndVoice()
                        }}
                    >
                        {pendingAction === 'end' ? t('voice.dropped.ending') : t('voice.dropped.endVoice')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
