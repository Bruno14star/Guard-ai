import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { X, UserPlus, UserCheck, MessageSquare, Send, ShieldCheck, MapPin } from 'lucide-react';
import { db } from '../firebase';
import { PublicProfile } from '../types';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { UserAvatar } from './UserAvatar';

interface UserProfileModalProps {
  targetUserId: string | null;
  currentUid: string;
  currentUserName: string;
  onClose: () => void;
}

interface ChatMsg {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: any;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  targetUserId,
  currentUid,
  currentUserName,
  onClose,
}) => {
  const globalProfile = useGlobalUserProfile(currentUserName, '');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState('');

  useEffect(() => {
    if (!targetUserId) return;
    const unsub = onSnapshot(doc(db, 'public_profiles', targetUserId), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as PublicProfile);
      } else {
        setProfile(null);
      }
    });

    const followId = `${currentUid}_${targetUserId}`;
    getDoc(doc(db, 'follows', followId))
      .then((snap) => setIsFollowing(snap.exists()))
      .catch(() => {});

    return () => unsub();
  }, [targetUserId, currentUid]);

  useEffect(() => {
    if (!targetUserId || !showChat || targetUserId === currentUid) return;
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', currentUid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: ChatMsg[] = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (Array.isArray(data.participants) && data.participants.includes(targetUserId)) {
          list.push({
            id: d.id,
            senderId: data.senderId,
            senderName: data.senderName,
            text: data.text,
            createdAt: data.createdAt,
          });
        }
      });
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return ta - tb;
      });
      setMessages(list);
    });
    return () => unsub();
  }, [targetUserId, currentUid, showChat]);

  if (!targetUserId) return null;

  const toggleFollow = async () => {
    if (!targetUserId || targetUserId === currentUid) return;
    const followId = `${currentUid}_${targetUserId}`;
    const ref = doc(db, 'follows', followId);
    if (isFollowing) {
      await deleteDoc(ref);
      setIsFollowing(false);
      await updateDoc(doc(db, 'public_profiles', targetUserId), {
        followersCount: increment(-1),
      }).catch(() => {});
      await updateDoc(doc(db, 'public_profiles', currentUid), {
        followingCount: increment(-1),
      }).catch(() => {});
    } else {
      await setDoc(ref, {
        followerId: currentUid,
        followingId: targetUserId,
        createdAt: serverTimestamp(),
      });
      setIsFollowing(true);
      await updateDoc(doc(db, 'public_profiles', targetUserId), {
        followersCount: increment(1),
      }).catch(() => {});
      await updateDoc(doc(db, 'public_profiles', currentUid), {
        followingCount: increment(1),
      }).catch(() => {});
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim() || !targetUserId) return;
    await addDoc(collection(db, 'chats'), {
      senderId: currentUid,
      senderName: currentUserName,
      receiverId: targetUserId,
      participants: [currentUid, targetUserId],
      text: chatText.trim(),
      createdAt: serverTimestamp(),
    });
    setChatText('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">Guard AI Profile</span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!profile ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading profile...</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <UserAvatar
                photoURL={targetUserId === currentUid ? globalProfile.photo || profile.photoURL : profile.photoURL}
                name={targetUserId === currentUid ? globalProfile.name || profile.fullName : profile.fullName}
                size="lg"
                borderVariant={targetUserId === currentUid ? 'purple' : 'green'}
                fallbackVariant={targetUserId === currentUid ? 'purple' : 'grey'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-lg font-extrabold text-white truncate">
                    {targetUserId === currentUid ? globalProfile.name || profile.fullName : profile.fullName}
                  </h3>
                  {profile.verifiedBadge && <ShieldCheck className="w-4 h-4 text-[#00E67A] shrink-0" />}
                </div>
                <p className="text-xs text-slate-400">@{profile.username || 'guardmember'}</p>
                <p className="text-xs text-slate-300 flex items-center gap-1 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-[#2E9BFF]" />
                  <span>
                    {profile.city || profile.userState || 'Nigeria'}
                  </span>
                </p>
              </div>
            </div>

            {profile.bio && <p className="text-sm text-slate-300">{profile.bio}</p>}

            <div className="grid grid-cols-4 gap-2 text-center bg-[#050B14] border border-slate-800 rounded-2xl p-3">
              <div>
                <p className="text-base font-bold font-mono text-white">{profile.followersCount || 0}</p>
                <p className="text-[11px] text-slate-400">Followers</p>
              </div>
              <div>
                <p className="text-base font-bold font-mono text-white">{profile.followingCount || 0}</p>
                <p className="text-[11px] text-slate-400">Following</p>
              </div>
              <div>
                <p className="text-base font-bold font-mono text-[#00E67A]">{profile.verifiedReports || 0}</p>
                <p className="text-[11px] text-slate-400">Verified</p>
              </div>
              <div>
                <p className="text-base font-bold font-mono text-[#2E9BFF]">{profile.totalScans || 0}</p>
                <p className="text-[11px] text-slate-400">Scans</p>
              </div>
            </div>

            {targetUserId !== currentUid && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={toggleFollow}
                  className={`py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer ${
                    isFollowing
                      ? 'bg-slate-800 text-white'
                      : 'bg-[#2E9BFF] text-white'
                  }`}
                >
                  {isFollowing ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                  <span>{isFollowing ? 'Following' : 'Follow'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowChat(!showChat)}
                  className="py-2.5 px-4 rounded-xl bg-[#050B14] border border-slate-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 text-[#00E67A]" />
                  <span>{showChat ? 'Hide Chat' : 'Message'}</span>
                </button>
              </div>
            )}

            {showChat && targetUserId !== currentUid && (
              <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-3 space-y-3">
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {messages.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">
                      Start a safe 1-to-1 message with {profile.fullName}
                    </p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-xl text-xs max-w-[85%] ${
                          m.senderId === currentUid
                            ? 'ml-auto bg-[#2E9BFF] text-white'
                            : 'bg-[#0C1626] text-slate-200 border border-slate-800'
                        }`}
                      >
                        <p>{m.text}</p>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={sendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="Type message..."
                    className="flex-1 px-3 py-2 rounded-xl bg-[#0C1626] border border-slate-800 text-xs text-white focus:outline-none focus:border-[#2E9BFF]"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-bold cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
