const { sequelize } = require('../config/database');

/**
 * Verify that all expected indexes exist in the database
 * This script checks if indexes defined in models match what's in the database
 */

async function verifyIndexes() {
  try {
    console.log('🔍 Verifying database indexes...\n');

    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const queryInterface = sequelize.getQueryInterface();

    // Expected indexes for each table
    const expectedIndexes = {
      vesu_pools: [
        'idx_vesu_pools_address',
        'idx_vesu_pools_asset_pair',
        'idx_vesu_pools_is_active',
        'idx_vesu_pools_last_synced',
      ],
      vesu_positions: [
        'idx_vesu_positions_user_id',
        'idx_vesu_positions_pool_address',
        'idx_vesu_positions_status',
        'idx_vesu_positions_health_factor',
        'idx_vesu_positions_user_pool',
        'idx_vesu_positions_status_health',
        'idx_vesu_positions_last_updated',
      ],
      vesu_transactions: [
        'idx_vesu_transactions_user_id',
        'idx_vesu_transactions_position_id',
        'idx_vesu_transactions_hash',
        'idx_vesu_transactions_type',
        'idx_vesu_transactions_status',
        'idx_vesu_transactions_user_type',
        'idx_vesu_transactions_created_at',
        'idx_vesu_transactions_timestamp',
      ],
      vesu_liquidations: [
        'idx_vesu_liquidations_position_id',
        'idx_vesu_liquidations_liquidator',
        'idx_vesu_liquidations_hash',
        'idx_vesu_liquidations_timestamp',
        'idx_vesu_liquidations_created_at',
      ],
    };

    let allIndexesPresent = true;

    // Check each table
    for (const [tableName, expectedIndexList] of Object.entries(expectedIndexes)) {
      console.log(`\n📊 Checking table: ${tableName}`);
      console.log('─'.repeat(60));

      try {
        // Get actual indexes from database
        const indexes = await queryInterface.showIndex(tableName);
        const actualIndexNames = indexes.map(idx => idx.name);

        console.log(`Expected indexes: ${expectedIndexList.length}`);
        console.log(`Actual indexes: ${actualIndexNames.length}`);

        // Check each expected index
        for (const expectedIndex of expectedIndexList) {
          const exists = actualIndexNames.includes(expectedIndex);
          if (exists) {
            console.log(`   ${expectedIndex}`);
          } else {
            console.log(`   ${expectedIndex} - MISSING`);
            allIndexesPresent = false;
          }
        }

        // Show any extra indexes
        const extraIndexes = actualIndexNames.filter(
          name => !expectedIndexList.includes(name) && 
                  !name.includes('pkey') && 
                  !name.includes('_id_key')
        );
        if (extraIndexes.length > 0) {
          console.log(`\n  ℹ  Additional indexes found:`);
          extraIndexes.forEach(idx => console.log(`     - ${idx}`));
        }

      } catch (error) {
        if (error.message.includes('does not exist')) {
          console.log(`    Table does not exist yet. Run migrations first.`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    if (allIndexesPresent) {
      console.log(' All expected indexes are present!');
    } else {
      console.log('  Some indexes are missing. Run migrations to create them.');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error(' Verification failed:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run verification
verifyIndexes();
