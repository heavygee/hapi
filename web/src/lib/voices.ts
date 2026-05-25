export interface Voice {
    id: string
    name: string
    gender: 'female' | 'male'
    description: string
}

export const VOICES: Voice[] = [
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', description: 'Default — warm, conversational' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', description: 'Calm, professional' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', description: 'Strong, confident' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', description: 'Soft, warm' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', description: 'Young, clear' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', description: 'Deep, smooth' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', description: 'Crisp, authoritative' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', description: 'Narration, clear' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', description: 'Well-rounded' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', description: 'Raspy, dynamic' },
]

export const DEFAULT_VOICE_ID = 'cgSgspJ2msm6clMCkdW9'

export function getVoiceById(id: string | null): Voice | undefined {
    return VOICES.find(v => v.id === id)
}
