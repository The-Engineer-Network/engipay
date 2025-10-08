"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Coins, TrendingUp, Clock, Zap } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { engiTokenService, rewardDistributorService } from '@/lib/starknet';
import { toast } from '@/hooks/use-toast';

export function StakingRewards() {
  const [stakedBalance, setStakedBalance] = useState('0');
  const [pendingRewards, setPendingRewards] = useState('0');
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [pools, setPools] = useState<any[]>([]);

  const { walletAddress } = useWallet();

  useEffect(() => {
    if (walletAddress) {
      loadStakingData();
      loadRewardPools();
    }
  }, [walletAddress]);

  const loadStakingData = async () => {
    if (!walletAddress) return;

    try {
      const [staked, rewards] = await Promise.all([
        engiTokenService.getStakedBalance(walletAddress),
        engiTokenService.getPendingRewards(walletAddress)
      ]);

      setStakedBalance(staked);
      setPendingRewards(rewards);
    } catch (error) {
      console.error('Error loading staking data:', error);
    }
  };

  const loadRewardPools = async () => {
    try {
      const totalPools = await rewardDistributorService.getTotalPools();
      const poolPromises = [];

      for (let i = 1; i <= parseInt(totalPools); i++) {
        poolPromises.push(rewardDistributorService.getPoolInfo(i.toString()));
      }

      const poolData = await Promise.all(poolPromises);
      setPools(poolData);
    } catch (error) {
      console.error('Error loading reward pools:', error);
    }
  };

  const handleStake = async () => {
    if (!stakeAmount || !walletAddress) return;

    setIsStaking(true);
    try {
      // Note: In production, you'd get the signer from wallet context
      // For now, this is a placeholder for the staking logic
      toast({
        title: 'Staking',
        description: `Staking ${stakeAmount} ENGI tokens...`,
      });

      // Reset form
      setStakeAmount('');
      await loadStakingData();
    } catch (error: any) {
      toast({
        title: 'Staking Failed',
        description: error.message || 'Failed to stake tokens',
        variant: 'destructive',
      });
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async () => {
    if (!unstakeAmount || !walletAddress) return;

    setIsUnstaking(true);
    try {
      toast({
        title: 'Unstaking',
        description: `Unstaking ${unstakeAmount} ENGI tokens...`,
      });

      setUnstakeAmount('');
      await loadStakingData();
    } catch (error: any) {
      toast({
        title: 'Unstaking Failed',
        description: error.message || 'Failed to unstake tokens',
        variant: 'destructive',
      });
    } finally {
      setIsUnstaking(false);
    }
  };

  const handleClaimRewards = async () => {
    if (!walletAddress) return;

    setIsClaiming(true);
    try {
      toast({
        title: 'Claiming Rewards',
        description: 'Claiming your staking rewards...',
      });

      await loadStakingData();
    } catch (error: any) {
      toast({
        title: 'Claim Failed',
        description: error.message || 'Failed to claim rewards',
        variant: 'destructive',
      });
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Staking Overview */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="glassmorphism">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Staked Balance</p>
                <p className="text-2xl font-bold">{parseFloat(stakedBalance).toFixed(2)} ENGI</p>
              </div>
              <Coins className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="glassmorphism">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Rewards</p>
                <p className="text-2xl font-bold text-green-400">{parseFloat(pendingRewards).toFixed(4)} ENGI</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glassmorphism">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Reward Rate</p>
                <p className="text-2xl font-bold">5% APY</p>
              </div>
              <Clock className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Staking Actions */}
      <Card className="glassmorphism">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Staking Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Stake */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Stake ENGI Tokens</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Amount to stake"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="glassmorphism"
                />
                <Button
                  onClick={handleStake}
                  disabled={isStaking || !stakeAmount}
                  className="glow-button bg-primary hover:bg-primary/90"
                >
                  {isStaking ? 'Staking...' : 'Stake'}
                </Button>
              </div>
            </div>

            {/* Unstake */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Unstake ENGI Tokens</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Amount to unstake"
                  value={unstakeAmount}
                  onChange={(e) => setUnstakeAmount(e.target.value)}
                  className="glassmorphism"
                />
                <Button
                  onClick={handleUnstake}
                  disabled={isUnstaking || !unstakeAmount}
                  variant="outline"
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                >
                  {isUnstaking ? 'Unstaking...' : 'Unstake'}
                </Button>
              </div>
            </div>
          </div>

          {/* Claim Rewards */}
          <div className="flex justify-center">
            <Button
              onClick={handleClaimRewards}
              disabled={isClaiming || parseFloat(pendingRewards) === 0}
              className="glow-button bg-green-500 hover:bg-green-500/90 text-white px-8"
            >
              {isClaiming ? 'Claiming...' : `Claim ${parseFloat(pendingRewards).toFixed(4)} ENGI Rewards`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reward Pools */}
      {pools.length > 0 && (
        <Card className="glassmorphism">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5" />
              Reward Pools
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pools.map((pool, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                  <div>
                    <p className="font-medium">Pool #{index + 1}</p>
                    <p className="text-sm text-muted-foreground">
                      {pool.total_staked || '0'} tokens staked
                    </p>
                  </div>
                  <Badge variant="secondary">
                    Active
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}