# Windows Setup Guide for Scarb & Starknet Tools

## Issue: 'scarb' is not recognized

This means Scarb isn't installed or not in your system PATH.

## Solution 1: Install Scarb (Recommended)

### Option A: Using asdf (Recommended)

1. **Install asdf for Windows:**
   ```powershell
   # Install via Git
   git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.13.1
   ```

2. **Add asdf to PATH:**
   - Open PowerShell as Administrator
   - Run:
   ```powershell
   $env:Path += ";$HOME\.asdf\bin;$HOME\.asdf\shims"
   [Environment]::SetEnvironmentVariable("Path", $env:Path, [System.EnvironmentVariableTarget]::User)
   ```

3. **Install Scarb plugin:**
   ```powershell
   asdf plugin add scarb
   asdf install scarb 2.6.3
   asdf global scarb 2.6.3
   ```

4. **Verify installation:**
   ```powershell
   scarb --version
   ```

### Option B: Manual Installation

1. **Download Scarb:**
   - Go to: https://docs.swmansion.com/scarb/download.html
   - Download Windows binary (scarb-v2.6.3-x86_64-pc-windows-msvc.zip)

2. **Extract and Install:**
   ```powershell
   # Extract to C:\Program Files\Scarb
   # Or any directory you prefer
   ```

3. **Add to PATH:**
   - Open System Properties → Environment Variables
   - Add Scarb bin directory to PATH:
     ```
     C:\Program Files\Scarb\bin
     ```
   - Or via PowerShell:
   ```powershell
   $scarbPath = "C:\Program Files\Scarb\bin"
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$scarbPath", [System.EnvironmentVariableTarget]::User)
   ```

4. **Restart terminal and verify:**
   ```powershell
   scarb --version
   ```

### Option C: Using Chocolatey

1. **Install Chocolatey** (if not installed):
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
   iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
   ```

2. **Install Scarb:**
   ```powershell
   choco install scarb
   ```

## Solution 2: Use Pre-built Contracts (Quick Alternative)

If you can't install Scarb right now, you can use pre-compiled contracts:

### Step 1: Get Pre-compiled Contracts

The contracts are already written. You just need to compile them once on a system with Scarb, or use Remix/online tools.

### Step 2: Use Starknet Foundry (Alternative)

```powershell
# Install Starknet Foundry (includes snforge)
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh
```

## Solution 3: Use Docker (Easiest for Windows)

### Step 1: Install Docker Desktop
Download from: https://www.docker.com/products/docker-desktop/

### Step 2: Create Dockerfile

I'll create this for you in the next step.

### Step 3: Build and Deploy via Docker

```powershell
cd smart-contracts
docker build -t engipay-contracts .
docker run -v ${PWD}:/workspace engipay-contracts scarb build
```

## Solution 4: Use WSL (Windows Subsystem for Linux)

### Step 1: Install WSL
```powershell
wsl --install
```

### Step 2: Install Scarb in WSL
```bash
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
```

### Step 3: Build in WSL
```bash
cd /mnt/c/path/to/your/project/smart-contracts
scarb build
```

## Verify Installation

After installing Scarb, verify it works:

```powershell
# Check version
scarb --version

# Should output something like:
# scarb 2.6.3 (58cc88efb 2024-04-09)
# cairo: 2.6.3 (https://crates.io/crates/cairo-lang-compiler/2.6.3)
# sierra: 1.5.0
```

## Install Starkli (For Deployment)

After Scarb is working, install Starkli:

### Windows (PowerShell)
```powershell
# Download starkliup installer
Invoke-WebRequest -Uri "https://get.starkli.sh" -OutFile "starkliup.ps1"
.\starkliup.ps1

# Or use cargo
cargo install starkli
```

### Verify Starkli
```powershell
starkli --version
```

## Quick Test

Once installed, test the build:

```powershell
cd smart-contracts
scarb clean
scarb build
```

You should see:
```
   Compiling engipay_contracts v0.1.0 (...)
    Finished release target(s) in X seconds
```

## Troubleshooting

### Issue: "scarb: command not found" after installation

**Solution:** Restart your terminal or run:
```powershell
refreshenv
# Or
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

### Issue: Permission denied

**Solution:** Run PowerShell as Administrator

### Issue: SSL/TLS errors

**Solution:**
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

### Issue: Can't find Cairo compiler

**Solution:** Scarb includes Cairo, but if needed:
```powershell
asdf install cairo 2.6.3
```

## Next Steps

After Scarb is installed:

1. ✅ Build contracts: `scarb build`
2. ✅ Run deployment script: `scripts\deploy-all-contracts.bat`
3. ✅ Or deploy manually using the commands in `DEPLOYMENT_GUIDE.md`

## Alternative: Use Online IDE

If installation is too complex, use:
- **Remix for Starknet:** https://remix.ethereum.org/ (with Starknet plugin)
- **Starknet Playground:** https://www.starknetplayground.com/

## Need Help?

- Scarb docs: https://docs.swmansion.com/scarb/
- Starknet docs: https://docs.starknet.io/
- Cairo book: https://book.cairo-lang.org/
