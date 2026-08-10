import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDingUserProfile } from '../src/services/dingtalk.js';

test('DingTalk department member maps administrator and profile fields', () => {
  const profile = normalizeDingUserProfile({
    userid: 'zhangsan',
    unionid: 'union-1',
    name: '张三',
    admin: 'true',
    leader: true,
    title: '技术总监',
    mobile: '18500000000',
    role_list: { id: 100, name: '总监', group_name: '职务' }
  });

  assert.equal(profile.dingUserId, 'zhangsan');
  assert.equal(profile.isDingAdmin, true);
  assert.equal(profile.isLeader, true);
  assert.equal(profile.title, '技术总监');
  assert.deepEqual(profile.dingRoles, [{ id: '100', name: '总监', groupName: '职务' }]);
});

test('DingTalk ordinary member is not treated as an administrator', () => {
  const profile = normalizeDingUserProfile({ userid: 'lisi', name: '李四', admin: false });
  assert.equal(profile.isDingAdmin, false);
  assert.equal(profile.name, '李四');
});
