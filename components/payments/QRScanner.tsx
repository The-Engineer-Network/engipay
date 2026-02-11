"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QrCode, Camera, X, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface QRScannerProps {
  onScan: (data: any) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    try {
      setError(null);
      
      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Use back camera on mobile
      });

      streamRef.current = stream;
      setHasPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setScanning(true);

        // Start scanning for QR codes
        scanIntervalRef.current = setInterval(() => {
          scanQRCode();
        }, 500); // Scan every 500ms
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setHasPermission(false);
      setError('Camera access denied. Please enable camera permissions.');
      toast({
        title: 'Camera Access Denied',
        description: 'Please enable camera permissions to scan QR codes.',
        variant: 'destructive',
      });
    }
  };

  const stopScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setScanning(false);
  };

  const scanQRCode = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get image data
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    // Try to decode QR code using jsQR (we'll use a simple implementation)
    try {
      const code = detectQRCode(imageData);
      if (code) {
        handleQRCodeDetected(code);
      }
    } catch (err) {
      console.error('QR decode error:', err);
    }
  };

  // Simple QR code detection (in production, use jsQR library)
  const detectQRCode = (imageData: ImageData): string | null => {
    // This is a placeholder - in production, use jsQR library
    // For now, we'll return null and rely on manual input
    return null;
  };

  const handleQRCodeDetected = (data: string) => {
    stopScanning();

    try {
      // Parse QR code data
      const parsedData = JSON.parse(data);
      
      toast({
        title: 'QR Code Scanned',
        description: 'Payment information loaded successfully',
      });

      onScan(parsedData);
    } catch (err) {
      // If not JSON, treat as plain text (address)
      onScan({ address: data });
    }
  };

  const handleManualInput = () => {
    stopScanning();
    toast({
      title: 'Manual Input',
      description: 'Enter payment details manually',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <Card className="glassmorphism max-w-md w-full border-primary/30">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            Scan QR Code
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => {
            stopScanning();
            onClose();
          }}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!scanning && !error && (
            <div className="text-center space-y-4">
              <div className="bg-muted/20 p-8 rounded-lg">
                <Camera className="w-16 h-16 mx-auto text-primary mb-4" />
                <p className="text-sm text-muted-foreground">
                  Click the button below to start scanning
                </p>
              </div>
              <Button
                onClick={startScanning}
                className="w-full glow-button bg-primary hover:bg-primary/90"
              >
                <Camera className="w-4 h-4 mr-2" />
                Start Camera
              </Button>
            </div>
          )}

          {scanning && (
            <div className="space-y-4">
              <div className="relative bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  className="w-full h-64 object-cover"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Scanning overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-primary rounded-lg">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                  </div>
                </div>
              </div>
              
              <p className="text-sm text-center text-muted-foreground">
                Position the QR code within the frame
              </p>

              <Button
                onClick={stopScanning}
                variant="outline"
                className="w-full"
              >
                Stop Scanning
              </Button>
            </div>
          )}

          {error && (
            <div className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Camera Access Required</p>
                    <p className="text-sm text-muted-foreground mt-1">{error}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  onClick={startScanning}
                  variant="outline"
                  className="w-full"
                >
                  Try Again
                </Button>
                <Button
                  onClick={handleManualInput}
                  className="w-full"
                >
                  Enter Manually
                </Button>
              </div>
            </div>
          )}

          {hasPermission === null && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                💡 Tip: Make sure to allow camera access when prompted
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
