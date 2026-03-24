/**
 * 诊断脚本：检查为什么测试商店的订单不显示
 * 
 * 运行方式：npx tsx scripts/diagnose-orders.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnose() {
  console.log('\n========================================');
  console.log('🔍 AI Sales Tracker & Attribution 订单诊断工具');
  console.log('========================================\n');

  // 1. 检查所有店铺的设置
  console.log('📋 1. 店铺设置检查：');
  const settings = await prisma.shopSettings.findMany({
    select: {
      shopDomain: true,
      primaryCurrency: true,
      timezone: true,
      language: true,
    }
  });
  
  if (settings.length === 0) {
    console.log('   ⚠️  没有找到任何店铺设置记录');
  } else {
    settings.forEach(s => {
      console.log(`   - 店铺: ${s.shopDomain}`);
      console.log(`     货币: ${s.primaryCurrency}`);
      console.log(`     时区: ${s.timezone}`);
    });
  }

  // 2. 检查数据库中的订单
  console.log('\n📦 2. 订单数据检查：');
  const orderStats = await prisma.order.groupBy({
    by: ['shopDomain', 'currency'],
    _count: { id: true },
    orderBy: { shopDomain: 'asc' }
  });

  if (orderStats.length === 0) {
    console.log('   ⚠️  数据库中没有订单记录');
    console.log('   可能原因：');
    console.log('   - Webhook 未正确配置或未触发');
    console.log('   - 补拉（Backfill）未运行');
    console.log('   - 测试订单尚未创建');
  } else {
    console.log('   订单按店铺和货币统计：');
    orderStats.forEach(s => {
      console.log(`   - ${s.shopDomain}: ${s._count.id} 笔订单 (货币: ${s.currency})`);
    });
  }

  // 3. 检查货币不匹配问题
  console.log('\n⚠️  3. 货币匹配检查：');
  for (const setting of settings) {
    const matchingOrders = await prisma.order.count({
      where: {
        shopDomain: setting.shopDomain,
        currency: setting.primaryCurrency
      }
    });
    const totalOrders = await prisma.order.count({
      where: { shopDomain: setting.shopDomain }
    });
    
    if (totalOrders > 0 && matchingOrders === 0) {
      console.log(`   ❌ ${setting.shopDomain}: 严重问题！`);
      console.log(`      设置货币: ${setting.primaryCurrency}`);
      console.log(`      总订单数: ${totalOrders}`);
      console.log(`      匹配订单: ${matchingOrders}`);
      console.log(`      → 所有订单因货币不匹配而被过滤！`);
      
      // 获取实际货币
      const actualCurrencies = await prisma.order.groupBy({
        by: ['currency'],
        where: { shopDomain: setting.shopDomain },
        _count: { id: true }
      });
      console.log(`      实际订单货币: ${actualCurrencies.map(c => c.currency).join(', ')}`);
      console.log(`\n      🔧 修复方法: 运行以下命令更新货币设置：`);
      const targetCurrency = actualCurrencies[0]?.currency || 'USD';
      console.log(`      npx prisma db execute --stdin <<< "UPDATE \\"ShopSettings\\" SET \\"primaryCurrency\\" = '${targetCurrency}' WHERE \\"shopDomain\\" = '${setting.shopDomain}';"`);
    } else if (totalOrders > 0) {
      console.log(`   ✅ ${setting.shopDomain}: 货币匹配正常`);
      console.log(`      设置货币: ${setting.primaryCurrency}, 匹配 ${matchingOrders}/${totalOrders} 笔订单`);
    }
  }

  // 4. 检查最近的订单
  console.log('\n📅 4. 最近订单检查：');
  const recentOrders = await prisma.order.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      shopDomain: true,
      name: true,
      createdAt: true,
      currency: true,
      totalPrice: true,
      sourceName: true,
      aiSource: true,
    }
  });

  if (recentOrders.length === 0) {
    console.log('   没有找到任何订单');
  } else {
    console.log('   最近 5 笔订单：');
    recentOrders.forEach(o => {
      console.log(`   - ${o.name} (${o.shopDomain})`);
      console.log(`     创建时间: ${o.createdAt}`);
      console.log(`     货币/金额: ${o.currency} ${o.totalPrice}`);
      console.log(`     来源: ${o.sourceName || 'N/A'}`);
      console.log(`     AI渠道: ${o.aiSource || '无'}`);
    });
  }

  // 5. 检查 Webhook 任务队列
  console.log('\n🔔 5. Webhook 任务队列检查：');
  const webhookStats = await prisma.webhookJob.groupBy({
    by: ['status', 'topic'],
    _count: { id: true }
  });

  if (webhookStats.length === 0) {
    console.log('   没有 Webhook 任务记录');
    console.log('   → 这可能意味着 Webhook 未正确注册或未触发');
  } else {
    console.log('   Webhook 任务统计：');
    webhookStats.forEach(s => {
      console.log(`   - ${s.topic}: ${s._count.id} 个 (${s.status})`);
    });
  }

  // 6. 检查 BackfillJob
  console.log('\n🔄 6. 补拉任务检查：');
  const backfillJobs = await prisma.backfillJob.findMany({
    take: 3,
    orderBy: { createdAt: 'desc' },
    select: {
      shopDomain: true,
      range: true,
      status: true,
      ordersFetched: true,
      error: true,
      createdAt: true,
    }
  });

  if (backfillJobs.length === 0) {
    console.log('   没有补拉任务记录');
    console.log('   → 建议在仪表盘页面点击"后台补拉"按钮');
  } else {
    console.log('   最近补拉任务：');
    backfillJobs.forEach(j => {
      console.log(`   - ${j.shopDomain}: ${j.status}`);
      console.log(`     范围: ${j.range}`);
      console.log(`     获取订单数: ${j.ordersFetched}`);
      if (j.error) console.log(`     错误: ${j.error}`);
    });
  }

  console.log('\n========================================');
  console.log('诊断完成');
  console.log('========================================\n');

  await prisma.$disconnect();
}

diagnose().catch(async (e) => {
  console.error('诊断出错:', e);
  await prisma.$disconnect();
  process.exit(1);
});
