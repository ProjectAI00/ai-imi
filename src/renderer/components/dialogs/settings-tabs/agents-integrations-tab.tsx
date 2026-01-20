"use client"

import { useState, useEffect } from "react"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { toast } from "sonner"
import { IconSpinner } from "../../ui/icons"
import { Eye, EyeOff, ExternalLink } from "lucide-react"

export function AgentsIntegrationsTab() {
  const [ampApiKey, setAmpApiKey] = useState("")
  const [showAmpKey, setShowAmpKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Load existing API keys on mount
  useEffect(() => {
    loadApiKeys()
  }, [])

  const loadApiKeys = async () => {
    try {
      // Get API keys from main process
      const keys = await window.desktopApi?.getApiKeys?.() || {}
      setAmpApiKey(keys.ampApiKey || "")
    } catch (error) {
      console.error("Failed to load API keys:", error)
    }
  }

  const saveAmpApiKey = async () => {
    if (!ampApiKey.trim()) {
      toast.error("Please enter your AMP API key")
      return
    }

    setIsSaving(true)
    try {
      await window.desktopApi?.setApiKey?.("amp", ampApiKey.trim())
      toast.success("AMP API key saved successfully")
    } catch (error) {
      console.error("Failed to save AMP API key:", error)
      toast.error("Failed to save API key")
    } finally {
      setIsSaving(false)
    }
  }

  const testAmpConnection = async () => {
    if (!ampApiKey.trim()) {
      toast.error("Please enter your AMP API key first")
      return
    }

    try {
      // Test the API key by making a simple request
      const result = await window.desktopApi?.testApiKey?.("amp", ampApiKey.trim())
      if (result?.success) {
        toast.success("AMP API key is valid")
      } else {
        toast.error(result?.error || "API key validation failed")
      }
    } catch (error) {
      console.error("Failed to test AMP API key:", error)
      toast.error("Failed to test API key")
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {!window.innerWidth <= 768 && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Integrations</h3>
          <p className="text-xs text-muted-foreground">
            Connect your accounts and API keys for third-party services
          </p>
        </div>
      )}

      {/* AMP Integration */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground">AMP</h4>
              <p className="text-xs text-muted-foreground">
                Connect your AMP account for AI coding assistance
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium">API Key</Label>
              <div className="relative">
                <Input
                  type={showAmpKey ? "text" : "password"}
                  value={ampApiKey}
                  onChange={(e) => setAmpApiKey(e.target.value)}
                  placeholder="Enter your AMP API key"
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowAmpKey(!showAmpKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAmpKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://ampcode.com/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  ampcode.com/settings
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={saveAmpApiKey}
                disabled={!ampApiKey.trim() || isSaving}
                size="sm"
                className="text-xs"
              >
                {isSaving && <IconSpinner className="h-3 w-3 mr-1.5" />}
                Save Key
              </Button>
              <Button
                onClick={testAmpConnection}
                disabled={!ampApiKey.trim()}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Test Connection
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Future integrations placeholder */}
      <div className="bg-muted/50 rounded-lg border border-dashed border-border p-4">
        <div className="text-center text-muted-foreground">
          <p className="text-xs">More integrations coming soon...</p>
        </div>
      </div>
    </div>
  )
}